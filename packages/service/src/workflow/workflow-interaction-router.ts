import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
import { WorkflowActorHost } from './workflow-actor-host.js';

type ActorRefLike = {
  getSnapshot: () => unknown;
  send?: (event: unknown) => void;
  id?: string;
};

export interface ActiveWorkflowInteraction {
  runId: string;
  sessionId: string;
  actorPath: string;
  /** Opaque persisted cursor; callers must send events through this router. */
  cursor: string;
}

export interface ChatTurnDispatchResult {
  assistantMessage?: string;
}

/** Routes a typed interaction event to the live root actor associated with a session. */
export class WorkflowInteractionRouter {
  constructor(
    private readonly runs: IWorkflowRunRepository,
    private readonly actorHost: WorkflowActorHost
  ) {}

  async resolveActiveRun(sessionId: string): Promise<WorkflowRunRecord | null> {
    return this.runs.findActiveBySession(sessionId);
  }

  async resolveActiveInteraction(sessionId: string): Promise<ActiveWorkflowInteraction | null> {
    const run = await this.resolveActiveRun(sessionId);
    if (!run?.activeActorPath) return null;
    return {
      runId: run.id,
      sessionId,
      actorPath: run.activeActorPath,
      cursor: `${run.id}:${run.activeActorPath}`,
    };
  }

  async dispatchChatTurn(
    sessionId: string,
    message: string,
    expectedCursor?: string
  ): Promise<ChatTurnDispatchResult | null> {
    const interaction = await this.resolveActiveInteraction(sessionId);
    if (!interaction) return null;
    if (expectedCursor && interaction.cursor !== expectedCursor) {
      throw new Error(
        `Workflow interaction cursor mismatch for session '${sessionId}': expected '${expectedCursor}', current '${interaction.cursor}'.`
      );
    }

    const liveRun = this.actorHost.getLiveRun(interaction.runId);
    if (!liveRun) {
      throw new Error(
        `Workflow run '${interaction.runId}' is active but is not loaded in this process.`
      );
    }

    const target = this.resolveTargetActor(liveRun, interaction.actorPath);
    const before = this.readChatContext(liveRun, interaction.actorPath);
    const beforeMessages = before.messages.length;
    const beforeAssistant = this.lastAssistantMessage(before.messages);

    target.send({ type: 'CHAT_TURN', message });

    const after = await this.waitForChatTurnResult(liveRun, interaction.actorPath, beforeMessages);
    const afterAssistant = this.lastAssistantMessage(after.messages);
    return {
      ...(afterAssistant && afterAssistant !== beforeAssistant
        ? { assistantMessage: afterAssistant }
        : {}),
    };
  }

  async dispatch(
    sessionId: string,
    event: unknown,
    expectedCursor?: string
  ): Promise<WorkflowRunRecord | null> {
    const run = await this.resolveActiveRun(sessionId);
    if (!run) return null;
    if (expectedCursor) {
      if (!run.activeActorPath) {
        throw new Error(
          `Workflow interaction cursor mismatch for session '${sessionId}': expected '${expectedCursor}', current '<none>'.`
        );
      }
      const cursor = `${run.id}:${run.activeActorPath}`;
      if (cursor !== expectedCursor) {
        throw new Error(
          `Workflow interaction cursor mismatch for session '${sessionId}': expected '${expectedCursor}', current '${cursor}'.`
        );
      }
    }

    const liveRun = this.actorHost.getLiveRun(run.id);
    if (!liveRun) {
      throw new Error(`Workflow run '${run.id}' is active but is not loaded in this process.`);
    }
    const target = run.activeActorPath
      ? this.tryResolveTargetActor(liveRun, run.activeActorPath)
      : undefined;
    if (target) {
      target.send(event);
    } else {
      await liveRun.dispatch(event);
    }
    return run;
  }

  private async waitForChatTurnResult(
    run: NonNullable<ReturnType<WorkflowActorHost['getLiveRun']>>,
    actorPath: string,
    beforeMessages: number
  ): Promise<{ messages: Array<{ role: string; content: string }> }> {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      const context = this.readChatContext(run, actorPath);
      if (context.messages.length > beforeMessages && !context.pendingMessage) {
        return context;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(
      `Timed out waiting for workflow chat turn completion on actor '${actorPath}'.`
    );
  }

  private readChatContext(
    run: NonNullable<ReturnType<WorkflowActorHost['getLiveRun']>>,
    actorPath: string
  ): {
    messages: Array<{ role: string; content: string }>;
    pendingMessage?: string;
  } {
    const target = this.resolveTargetActor(run, actorPath);
    const childSnapshot = target.getSnapshot() as {
      context?: {
        messages?: Array<{ role: string; content: string }>;
        pendingMessage?: string;
      };
    };
    const messages = childSnapshot?.context?.messages;
    if (!Array.isArray(messages)) {
      throw new Error(`Workflow chat actor '${actorPath}' has no readable message history.`);
    }
    return {
      messages,
      ...(typeof childSnapshot.context?.pendingMessage === 'string'
        ? { pendingMessage: childSnapshot.context.pendingMessage }
        : {}),
    };
  }

  private lastAssistantMessage(messages: Array<{ role: string; content: string }>): string | undefined {
    const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    return latestAssistant?.content;
  }

  private resolveTargetActor(
    run: NonNullable<ReturnType<WorkflowActorHost['getLiveRun']>>,
    actorPath: string
  ): { send: (event: unknown) => void; getSnapshot: () => unknown } {
    const target = this.tryResolveTargetActor(run, actorPath);
    if (target) return target;
    throw new Error(`Workflow chat actor '${actorPath}' was not found in the active run snapshot.`);
  }

  private tryResolveTargetActor(
    run: NonNullable<ReturnType<WorkflowActorHost['getLiveRun']>>,
    actorPath: string
  ): { send: (event: unknown) => void; getSnapshot: () => unknown } | undefined {
    const segments = actorPath.split('.').filter((segment) => segment.length > 0);
    if (segments.length === 0) return undefined;

    let current: ActorRefLike | undefined = run as ActorRefLike;
    for (const segment of segments) {
      const snapshot = current?.getSnapshot() as {
        children?: Record<string, { getSnapshot?: () => unknown; send?: (event: unknown) => void }>;
      } | undefined;
      const next = this.findChildActor(snapshot?.children, segment);
      if (!next || typeof next.getSnapshot !== 'function') {
        current = undefined;
        break;
      }
      current = next;
    }

    if (!current || typeof current.getSnapshot !== 'function' || typeof current.send !== 'function') {
      if (!actorPath.includes('.')) {
        const nested = this.findNestedActorById(run as ActorRefLike, actorPath);
        if (nested && typeof nested.getSnapshot === 'function' && typeof nested.send === 'function') {
          return {
            send: (event: unknown) => nested.send(event),
            getSnapshot: () => nested.getSnapshot(),
          };
        }
      }
      return undefined;
    }
    const currentSend = current.send;
    if (typeof currentSend !== 'function') {
      return undefined;
    }
    return {
      send: (event: unknown) => currentSend(event),
      getSnapshot: () => current.getSnapshot(),
    };
  }

  private findChildActor(
    children: Record<string, { getSnapshot?: () => unknown; send?: (event: unknown) => void; id?: string }>
    | undefined,
    segment: string
  ): ActorRefLike | undefined {
    if (!children) return undefined;
    const direct = children[segment];
    if (direct && typeof direct.getSnapshot === 'function') return direct as ActorRefLike;
    const byId = Object.values(children).find(
      (child) => child?.id === segment && typeof child.getSnapshot === 'function'
    );
    return byId as ActorRefLike | undefined;
  }

  private findNestedActorById(
    root: ActorRefLike,
    actorId: string
  ): { getSnapshot: () => unknown; send: (event: unknown) => void } | undefined {
    const queue: ActorRefLike[] = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const snapshot = current.getSnapshot() as {
        children?: Record<string, { getSnapshot?: () => unknown; send?: (event: unknown) => void; id?: string }>;
      };
      const children = snapshot?.children;
      if (!children) continue;
      for (const [key, child] of Object.entries(children)) {
        if (!child || typeof child.getSnapshot !== 'function') continue;
        if ((child.id ?? key) === actorId && typeof child.send === 'function') {
          const childGetSnapshot = child.getSnapshot;
          const childSend = child.send;
          return {
            getSnapshot: () => childGetSnapshot(),
            send: (event: unknown) => childSend(event),
          };
        }
        queue.push(child as ActorRefLike);
      }
    }
    return undefined;
  }
}
