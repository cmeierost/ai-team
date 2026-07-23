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
import { UserMessage } from '../tui/user-message.js';
import { ThinkingBlock } from '../tui/thinking-block.js';
import { ExtensionRegistry } from '../extensions/index.js';

/**
 * Event handler function type.
 */
export type EventHandler = (
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  registry: ExtensionRegistry
) => Component | null;

/**
 * Shared state for event handlers.
 */
export interface WorkflowEventState {
  currentAgentId?: string;
  currentAgent: AgentDisplayInfo | null;
  currentResponse: AgentResponse | null;
  currentThinking?: ThinkingBlock | null;
  currentUserMessage?: UserMessage | null;
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
  ): Component | null {
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

  return null;
}

function handleTool(
  event: StreamEvent<'chat'>,
  state: WorkflowEventState,
  registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const toolName = payload.toolName ?? payload.name ?? 'unknown';
  const toolResult = payload.toolResult;
  const input = toolResult?.request ?? payload.input;
  const commandResponse = toolResult?.commandResponse;
  const output =
    commandResponse?.data
    ?? commandResponse?.message
    ?? toolResult?.resultLlm
    ?? payload.output;
  state.currentResponse = null;
  collapseThinking(state);

  if (
    toolName.startsWith('slash:')
    && (payload.toolPhase === 'result' || payload.toolPhase === 'error')
  ) {
    const resultText = formatTranscriptValue(output);
    if (state.currentUserMessage) {
      state.currentUserMessage.setResult(resultText);
      return null;
    }
    const message = new UserMessage('', state.developerName);
    message.setResult(resultText);
    state.currentUserMessage = message;
    return message;
  }

  const custom = registry.renderTool(toolName, input, output);
  if (custom) return custom;

  const toolKey = payload.toolCallId ?? toolName;
  const toolComponents = state.toolComponents ?? new Map<string, ToolEvent>();
  state.toolComponents = toolComponents;
  const existing = toolComponents.get(toolKey);
  if (existing) {
    existing.update(input, output, payload.toolPhase);
    return null;
  }

  const component = new ToolEvent(toolName, input, output, payload.toolPhase);
  toolComponents.set(toolKey, component);
  return component;
}

function formatTranscriptValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
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
    return new UserMessage(content, developerName);
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
  const filePath = payload.filePath ?? payload.file ?? 'unknown';
  const diff = payload.diff ?? payload.patch ?? '';

  return new CodeEditProposal(filePath, diff);
}

function handleLog(
  event: StreamEvent<'chat'>,
  _state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const message = payload.message ?? payload.text ?? '';
  const level = (payload.level ?? 'info') as any;

  const log = new PreviousLog();
  log.addMessage(level, message);
  return log;
}

function handleError(
  event: StreamEvent<'chat'>,
  _state: WorkflowEventState,
  _registry: ExtensionRegistry
): Component | null {
  const payload = event as any;
  const message = payload.message ?? payload.error ?? 'Unknown error';

  const log = new PreviousLog();
  log.addMessage('error', message);
  return log;
}
