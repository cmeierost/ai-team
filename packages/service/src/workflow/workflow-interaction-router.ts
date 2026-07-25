import type { IWorkflowRunRepository, WorkflowRunRecord } from '@ai-team/core';
import { WorkflowActorHost } from './workflow-actor-host.js';

/** Routes a typed interaction event to the live root actor associated with a session. */
export class WorkflowInteractionRouter {
  constructor(
    private readonly runs: IWorkflowRunRepository,
    private readonly actorHost: WorkflowActorHost
  ) {}

  async resolveActiveRun(sessionId: string): Promise<WorkflowRunRecord | null> {
    return this.runs.findActiveBySession(sessionId);
  }

  async dispatch(sessionId: string, event: unknown): Promise<WorkflowRunRecord | null> {
    const run = await this.resolveActiveRun(sessionId);
    if (!run) return null;

    const liveRun = this.actorHost.getLiveRun(run.id);
    if (!liveRun) {
      throw new Error(`Workflow run '${run.id}' is active but is not loaded in this process.`);
    }
    await liveRun.dispatch(event);
    return run;
  }
}
