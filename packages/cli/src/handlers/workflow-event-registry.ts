/**
 * Workflow event registry — maps StreamEvent kinds to handlers.
 */

import { Component } from '@ai-team/tui';
import { StreamEvent } from '@ai-team/api-contracts';
import { AgentDisplayInfo, resolveAgentDisplay } from '../tui/agent-color.js';
import { AgentResponse } from '../tui/agent-response.js';
import { ToolEvent } from '../tui/tool-event.js';
import { HandoffTransition } from '../tui/handoff-transition.js';
import { CodeEditProposal } from '../tui/code-edit-proposal.js';
import { PreviousLog } from '../tui/previous-log.js';
import { ChatCommandHint } from '../tui/chat-command-hint.js';
import { UserMessage } from '../tui/user-message.js';
import { ThinkingBlock } from '../tui/thinking-block.js';
import { writeCliLog } from './cli-log.js';
import {
  ExtensionRegistry,
  type NormalizedToolEvent,
  type ToolRenderDecision,
} from '../extensions/index.js';

export type EventProjection = Component | ToolRenderDecision;

/**
 * Event handler function type.
 */
export type EventHandler = (
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  registry: ExtensionRegistry
) => EventProjection | null;

/**
 * Shared state for event handlers.
 */
export interface WorkflowEventState {
  currentAgentId?: string;
  currentAgent: AgentDisplayInfo | null;
  currentResponse: AgentResponse | null;
  currentThinking?: ThinkingBlock | null;
  currentHandoff?: HandoffTransition | null;
  currentHandoffId?: string;
  currentUserMessage?: UserMessage | null;
  lastErrorMessage?: string;
  developerName?: string;
  workflowName?: string;
  toolComponents?: Map<string, ToolEvent>;
}

/**
 * Workflow event registry — handles all StreamEvent kinds.
 */
export class WorkflowEventRegistry {
  private readonly handlers: Map<string, EventHandler[]> = new Map();

  constructor() {
    this.registerDefaults();
  }

  /**
   * Register default handlers for all StreamEvent kinds.
   */
  private registerDefaults(): void {
    this.register('token', handleToken);
    this.register('agent_info', handleAgentInfo);
    this.register('history_message', handleHistoryMessage);
    this.register('tool', handleTool);
    this.register('handoff', handleHandoff);
    this.register('code_edit_proposal', handleCodeEditProposal);
    this.register('workflow_started', handleWorkflowLifecycle);
    this.register('workflow_actor', handleWorkflowLifecycle);
    this.register('workflow_state', handleWorkflowLifecycle);
    this.register('workflow_completed', handleWorkflowLifecycle);
    this.register('workflow_restored', handleWorkflowLifecycle);
    this.register('workflow_failed', handleWorkflowTerminalError);
    this.register('workflow_cancelled', handleWorkflowTerminalError);
    this.register('log', handleLog);
    this.register('error', handleError);
    this.register('turn_finished', handleTurnFinished);
  }

  /**
   * Register a handler for an event kind.
   */
  register(kind: string, handler: EventHandler): void {
    const existing = this.handlers.get(kind) ?? [];
    existing.push(handler);
    this.handlers.set(kind, existing);
  }

  /**
   * Handle a stream event. Returns a component to display, or null.
   */
  handle(
    event: StreamEvent<'chat'>,
    state: WorkflowEventState,
    registry: ExtensionRegistry
  ): EventProjection | null {
    // Check extension handlers first
    const extensionHandlers = registry.getHandlers(event.kind);
    for (const handler of extensionHandlers) {
      const result = handler.handle(event);
      if (result) return result;
    }

    // Use built-in handlers
    const handlers = this.handlers.get(event.kind) ?? [];
    for (const handler of handlers) {
      const result = handler(event, state, registry);
      if (result) return result;
    }

    return null;
  }
}

// --- Default Handlers ---

function handleToken(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const token = (event as any).text ?? '';

  if (token.startsWith('💭 ')) {
    if (state.currentThinking) {
      state.currentThinking.append(token);
      return null;
    }
    const thinking = new ThinkingBlock(state.currentAgent ?? undefined);
    thinking.append(token);
    state.currentThinking = thinking;
    return thinking;
  }

  collapseThinking(state);

  if (state.currentResponse) {
    state.currentResponse.append(token);
    return null;
  }
  if (!state.currentAgent) return null;

  const response = new AgentResponse(state.currentAgent, state.developerName);
  response.append(token);
  state.currentResponse = response;
  return response;
}

function handleAgentInfo(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const agentName = payload.agentName ?? payload.name ?? 'Agent';
  const model = payload.llmModel ?? payload.model;
  const avatarColor = payload.avatarColor;

  state.currentAgentId = payload.agentId ?? state.currentAgentId;
  state.currentAgent = resolveAgentDisplay({ name: agentName, avatarColor, model });
  state.developerName = payload.developerName ?? state.developerName;
  if (payload.developerName && state.currentUserMessage) {
    state.currentUserMessage.setDeveloperName(payload.developerName);
  }
  state.currentResponse?.setIdentity(state.currentAgent, state.developerName);

  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  return message ? new ChatCommandHint(message) : null;
}

function handleTool(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  registry: ExtensionRegistry
): ToolRenderDecision {
  const payload = event as any;
  const toolName = payload.toolName ?? payload.name ?? 'unknown';
  const toolResult = payload.toolResult;
  const input = toolResult?.request ?? payload.input;
  const commandResponse = toolResult?.commandResponse;
  const legacyCommandIdentity = resolvePersistedCommandIdentity(input);
  const commandGroup = toolResult?.commandGroup ?? input?.group ?? legacyCommandIdentity?.group;
  const commandKey = toolResult?.commandKey ?? input?.key ?? legacyCommandIdentity?.key;
  // Generic slash rendering always uses the backend-formatted LLM value.
  // Exact renderers consume commandResponseData separately.
  const output = toolName.startsWith('slash:')
    ? (
        toolResult?.resultLlm
        ?? commandResponse?.message
        ?? commandResponse?.data
        ?? payload.output
      )
    : (
        commandResponse?.data
        ?? commandResponse?.message
        ?? toolResult?.resultLlm
        ?? payload.output
      );
  const historical = payload.historical === true;
  if (!historical) {
    state.currentResponse = null;
    collapseThinking(state);
  }

  const phase = normalizeToolPhase(payload.toolPhase, toolResult?.outcome);
  const normalized: NormalizedToolEvent = {
    toolName,
    phase,
    callId: typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined,
    commandGroup,
    commandKey,
    request: input,
    output,
    commandResponseData: unwrapCommandResponseData(commandResponse?.data),
    fileChanges: Array.isArray(toolResult?.fileChanges) ? toolResult.fileChanges : undefined,
    error:
      phase === 'error'
        ? (commandResponse?.message ?? payload.message ?? output)
        : undefined,
    denial: toolResult?.denial ?? payload.toolDenial,
    historical,
  };
  const custom = registry.renderTool(normalized);
  if (custom.handled) return custom;

  // Start is execution-state noise. The durable request and terminal outcome
  // are immutable transcript entries and must never rewrite one another.
  if (phase === 'start') {
    return { handled: true, placements: [] };
  }

  return transcriptPlacement(
    new ToolEvent(
      toolName,
      phase === 'request' ? input : undefined,
      phase === 'request' ? undefined : output,
      phase,
      historical
        ? { maxInputLines: 4, maxOutputLines: 8 }
        : undefined
    )
  );
}

function resolvePersistedCommandIdentity(
  input: Record<string, unknown> | undefined
): { group: string; key: string } | undefined {
  const commandToken = typeof input?.['commandToken'] === 'string'
    ? input['commandToken'].trim()
    : '';
  const tokenParts = commandToken.split(/\s+/).filter(Boolean);
  if (tokenParts.length >= 2) {
    return { group: tokenParts[0], key: tokenParts.slice(1).join('-') };
  }

  const commandKey = typeof input?.['commandKey'] === 'string'
    ? input['commandKey'].trim()
    : '';
  const separator = commandKey.indexOf('-');
  if (separator > 0 && separator < commandKey.length - 1) {
    return {
      group: commandKey.slice(0, separator),
      key: commandKey.slice(separator + 1),
    };
  }
  return undefined;
}

function unwrapCommandResponseData(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  const status = candidate['status'];
  if (
    (status === 'ok' || status === 'error' || status === 'cancelled') &&
    'data' in candidate
  ) {
    return candidate['data'];
  }
  return value;
}

function normalizeToolPhase(
  phase: unknown,
  outcome: unknown
): NormalizedToolEvent['phase'] {
  const value = typeof phase === 'string' ? phase : outcome;
  if (
    value === 'request'
    || value === 'start'
    || value === 'result'
    || value === 'error'
    || value === 'denied'
  ) return value;
  return 'start';
}

function transcriptPlacement(component: Component): ToolRenderDecision {
  return {
    handled: true,
    placements: [{ target: 'transcript', component }],
  };
}

function handleTurnFinished(
  _event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  collapseThinking(state);
  state.currentResponse = null;
  state.toolComponents?.clear();
  return null;
}

function handleHistoryMessage(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const content = typeof payload.content === 'string' ? payload.content : '';
  const developerName = payload.developerName ?? state.developerName;

  if (payload.isHuman) {
    const message = new UserMessage(content, developerName);
    if (payload.historical === true) {
      state.currentUserMessage = message;
    }
    return message;
  }

  const fallbackAgent = state.currentAgent;
  const agent = resolveAgentDisplay({
    name: payload.agentName ?? fallbackAgent?.name ?? 'Agent',
    avatarColor: payload.avatarColor,
    model: payload.llmModel ?? fallbackAgent?.model,
  });
  const response = new AgentResponse(agent, developerName);
  response.setText(content);
  return response;
}

function handleHandoff(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const handoffPhase = payload.handoffPhase as
    | 'start'
    | 'delta'
    | 'complete'
    | 'cancelled'
    | undefined;
  const handoffId = payload.handoffId as string | undefined;

  if (handoffPhase === 'delta') {
    if (!handoffId || !state.currentHandoffId || handoffId === state.currentHandoffId) {
      state.currentHandoff?.append(typeof payload.delta === 'string' ? payload.delta : '');
    }
    return null;
  }

  if (handoffPhase === 'cancelled') {
    if (!handoffId || !state.currentHandoffId || handoffId === state.currentHandoffId) {
      state.currentHandoff?.remove();
      state.currentHandoff = null;
      state.currentHandoffId = undefined;
    }
    return null;
  }

  const fromAgentName = payload.fromAgentName ?? state.currentAgent?.name ?? 'Agent';
  const currentAgent = state.currentAgent;
  const fromAgent =
    currentAgent && currentAgent.name === fromAgentName
      ? currentAgent
      : resolveAgentDisplay({
          name: fromAgentName,
          avatarColor: payload.fromAvatarColor,
          model: payload.fromLlmModel,
        });
  const toAgentName = payload.toAgentName ?? payload.toAgent ?? payload.agentName ?? 'Agent';
  const toAgentModel = payload.toLlmModel;
  const toAgentAvatarColor = payload.toAvatarColor;
  const toAgent = resolveAgentDisplay({
    name: toAgentName,
    avatarColor: toAgentAvatarColor,
    model: toAgentModel,
  });
  const reason = payload.handoffNote ?? payload.reason;
  const briefing = payload.briefingContent;

  if (handoffPhase === 'start') {
    collapseThinking(state);
    state.currentResponse = null;
    const transition = new HandoffTransition(fromAgent, toAgent);
    state.currentHandoff = transition;
    state.currentHandoffId = handoffId;
    return transition;
  }

  if (handoffPhase === 'complete' && state.currentHandoff) {
    if (!handoffId || !state.currentHandoffId || handoffId === state.currentHandoffId) {
      state.currentHandoff.setText(briefing?.trim() ? briefing : (reason ?? ''));
      state.currentHandoff = null;
      state.currentHandoffId = undefined;
      state.currentAgentId = payload.toAgentId ?? state.currentAgentId;
      state.currentAgent = toAgent;
      collapseThinking(state);
      state.currentResponse = null;
      return null;
    }
  }

  if (!payload.historical) {
    state.currentAgentId = payload.toAgentId ?? state.currentAgentId;
    state.currentAgent = toAgent;
  }
  collapseThinking(state);
  state.currentResponse = null;

  return new HandoffTransition(fromAgent, toAgent, reason, briefing);
}

function collapseThinking(state: WorkflowEventState): void {
  state.currentThinking?.collapse();
  state.currentThinking = null;
}

function handleCodeEditProposal(
  event: StreamEvent<'chat'>,
  _state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  // Applied filesystem tools expose their full changes on the matching tool
  // result. Rendering this notification as a legacy proposal duplicates the
  // diff and produces a misleading "unknown [Pending]" entry.
  if (Array.isArray(payload.files)) return null;
  const filePath = payload.filePath ?? payload.file ?? 'unknown';
  const diff = payload.diff ?? payload.patch ?? '';

  return new CodeEditProposal(filePath, diff);
}

function handleWorkflowLifecycle(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  if (typeof payload.workflowId === 'string' && payload.workflowId.trim()) {
    state.workflowName = payload.workflowId;
  }
  const log = new PreviousLog();
  switch (payload.kind) {
    case 'workflow_started':
      log.addMessage(
        'info',
        `workflow started: ${payload.workflowId ?? 'unknown'} (${payload.workflowInstanceId ?? 'n/a'})`
      );
      return log;
    case 'workflow_restored':
      log.addMessage(
        'info',
        `workflow restored: ${payload.workflowId ?? 'unknown'} (${payload.workflowInstanceId ?? 'n/a'})`
      );
      return log;
    case 'workflow_state':
      log.addMessage(
        'info',
        `workflow state: ${payload.stateValue ?? 'unknown'} (${payload.workflowInstanceId ?? 'n/a'})`
      );
      return log;
    case 'workflow_actor':
      log.addMessage(
        'info',
        `workflow actor: ${payload.actorEvent ?? 'event'} ${payload.actorRef ?? ''}`.trim()
      );
      return log;
    case 'workflow_completed':
      log.addMessage(
        'info',
        `workflow completed: ${payload.workflowId ?? 'unknown'} (${payload.finalState ?? 'done'})`
      );
      return log;
    default:
      return null;
  }
}

function handleWorkflowTerminalError(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : payload.kind === 'workflow_cancelled'
        ? `Workflow ${payload.workflowId ?? 'unknown'} cancelled.`
        : `Workflow ${payload.workflowId ?? 'unknown'} failed.`;
  return renderErrorOnce(message, state);
}

function handleLog(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const message = payload.message ?? payload.text ?? '';
  const level = (payload.level ?? 'info') as any;

  if (level === 'error') {
    return renderErrorOnce(String(message || 'Unknown error'), state);
  }

  const log = new PreviousLog();
  log.addMessage(level, message);
  return log;
}

function handleError(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const message = String(payload.message ?? payload.error ?? 'Unknown error');
  return renderErrorOnce(message, state);
}

function renderErrorOnce(message: string, state: WorkflowEventState): Component | null {
  if (message === state.lastErrorMessage) return null;
  state.lastErrorMessage = message;
  writeCliLog({
    source: 'chat-tui',
    level: 'error',
    error: message,
    agentId: state.currentAgentId,
    workflowName: state.workflowName,
  });

  const error = new AgentResponse({
    name: 'Error',
    color: { r: 220, g: 38, b: 38 },
  });
  error.setText(message);
  return error;
}
