/**
 * Chat orchestrator — ties TUI + ExtensionRegistry + WorkflowViewStack +
 * HeaderBar + WorkflowEventRegistry together.
 *
 * Replaces the ~1400 line monolithic renderChat with a clean ~100 line
 * orchestrator that delegates rendering to TUI components.
 */

import type { ChatOptions, CommandDescriptor } from '@ai-team/api-contracts';
import type { ITerminal } from '@ai-team/core';
import type { ICliCommandClient } from '../cli-command-client.js';
import { findWorkspaceRoot } from '@ai-team/infrastructure';
import { TUI, ProcessTerminal, Loader } from '@ai-team/tui';
import { ExtensionRegistry } from '../extensions/index.js';
import { HeaderBar } from '../tui/header-bar.js';
import { ChatView } from '../tui/chat-view.js';
import { WorkflowEventRegistry, type WorkflowEventState } from './workflow-event-registry.js';
import { normalizeAgentDisplayName, resolveAgentDisplay } from '../tui/agent-color.js';
import { Prompt } from '../tui/prompt.js';
import { UserMessage } from '../tui/user-message.js';
import { ChatLayout } from '../tui/chat-layout.js';
import { StatusLine } from '../tui/status-line.js';
import type { InquirerQuestionService } from './question-responders.js';

interface ChatTuiDependencies {
  terminal?: ITerminal;
  questionService?: InquirerQuestionService;
}

function setupAbortController() {
  const controller = new AbortController();
  let abortRequested = false;
  let forceExitTimer: NodeJS.Timeout | undefined;

  const requestAbort = (signalName: 'SIGINT' | 'SIGTERM') => {
    if (abortRequested) {
      process.exit(130);
      return;
    }
    abortRequested = true;
    controller.abort(new Error(`Aborted by ${signalName}`));
    forceExitTimer = setTimeout(() => {
      process.exit(130);
    }, 1500);
    forceExitTimer.unref();
  };

  const onSigint = () => requestAbort('SIGINT');
  const onSigterm = () => requestAbort('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  return {
    signal: controller.signal,
    wasAborted: () => abortRequested,
    dispose: () => {
      clearTimeout(forceExitTimer);
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
  };
}

function isAbortLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /aborted|abort/i.test(message);
}

interface ChatCtx {
  tui: TUI;
  headerBar: HeaderBar;
  chatView: ChatView;
  extensionRegistry: ExtensionRegistry;
  eventRegistry: WorkflowEventRegistry;
  eventState: WorkflowEventState;
  spinner: Loader;
  spinnerActive: boolean;
  prompt: Prompt;
  layout: ChatLayout;
  statusLine: StatusLine;
  workspaceRoot: string;
  gitBranch?: string;
  sessionId?: string;
  sessionTitle?: string;
  slashCommands: CommandDescriptor[];
}

function setSpinner(ctx: ChatCtx, v: boolean): void {
  ctx.spinnerActive = v;
  if (!v) {
    ctx.spinner.setVisible(false);
  }
}

function buildChatCtx(
  requestPayload: Record<string, unknown> | undefined,
  terminal: ITerminal,
  workspaceRoot: string
): Omit<ChatCtx, 'setSpinnerActive'> {
  const tui = new TUI(terminal);

  const headerBar = new HeaderBar();
  const extensionRegistry = new ExtensionRegistry();
  const eventRegistry = new WorkflowEventRegistry();

  const eventState: WorkflowEventState = {
    currentAgentId:
      requestPayload && typeof requestPayload['agentId'] === 'string'
        ? requestPayload['agentId']
        : undefined,
    currentAgent: null,
    currentResponse: null,
    workflowName: requestPayload?.['workflowName'] as string | undefined,
  };

  const spinner = new Loader('Agent is thinking…');

  const chatView = new ChatView();

  // Spinner (hidden by default)
  spinner.setVisible(false);

  // Prompt (created with empty text, updated before each prompt)
  const prompt = new Prompt('', () => {});
  prompt.invalidate();
  const statusLine = new StatusLine();
  statusLine.setLeft(`${workspaceRoot} -`);
  const sessionId =
    requestPayload && typeof requestPayload['sessionId'] === 'string'
      ? requestPayload['sessionId']
      : undefined;
  const slashCommands = Array.isArray(requestPayload?.['__slashSuggestions'])
    ? (requestPayload['__slashSuggestions'] as CommandDescriptor[])
    : [];

  // Resolve startup agent from payload
  const startupAgentName =
    requestPayload && typeof requestPayload['agentName'] === 'string'
      ? requestPayload['agentName']
      : undefined;
  const startupAgentId =
    requestPayload && typeof requestPayload['agentId'] === 'string'
      ? requestPayload['agentId']
      : undefined;
  const startupAgentModel =
    requestPayload && typeof requestPayload['llmModel'] === 'string'
      ? requestPayload['llmModel']
      : undefined;

  if (startupAgentName || startupAgentId) {
    eventState.currentAgent = resolveAgentDisplay({
      name: normalizeAgentDisplayName(startupAgentName, startupAgentId),
      model: startupAgentModel,
    });
    headerBar.setAgent(eventState.currentAgent);
  }

  const layout = new ChatLayout(terminal, headerBar, chatView, spinner, prompt, statusLine);
  tui.addChild(layout);

  const ctx = {
    tui,
    headerBar,
    chatView,
    extensionRegistry,
    eventRegistry,
    eventState,
    spinner,
    spinnerActive: false,
    prompt,
    layout,
    statusLine,
    workspaceRoot,
    sessionId,
    slashCommands,
  };
  updateStatusLine(ctx);
  return ctx;
}

function addToChatView(ctx: ChatCtx, component: unknown): void {
  ctx.chatView.getContent().addChild(component as any);
}

function handleStreamEvent(ctx: ChatCtx, event: unknown): boolean {
  const kind = (event as any)?.kind;
  if (!kind) return false;

  switch (kind) {
    case 'token':
    case 'tool':
    case 'error':
    case 'log':
      stopSpinner(ctx);
      break;
    case 'status':
      handleStatusEvent(ctx, event);
      return true;
    case 'agent_info':
      handleAgentInfoEvent(ctx, event);
      return true;
    case 'workspace_info':
      ctx.workspaceRoot =
        typeof (event as any).workspace === 'string' ? (event as any).workspace : ctx.workspaceRoot;
      ctx.gitBranch =
        typeof (event as any).gitBranch === 'string' ? (event as any).gitBranch : undefined;
      updateStatusLine(ctx);
      ctx.tui.invalidate();
      return true;
    case 'handoff':
      stopSpinner(ctx);
      break;
    case 'subworkflow_start':
      stopSpinner(ctx);
      handleSubworkflowStart(ctx, event);
      return true;
    case 'subworkflow_end':
      handleSubworkflowEnd(ctx);
      return true;
    case 'session_switched':
      ctx.sessionId = (event as any).sessionId ?? ctx.sessionId;
      ctx.eventState.currentAgentId = (event as any).agentId ?? ctx.eventState.currentAgentId;
      updateStatusLine(ctx);
      ctx.tui.invalidate();
      return true;
    case 'session_title_updated':
      ctx.sessionTitle = (event as any).title ?? ctx.sessionTitle;
      updateStatusLine(ctx);
      ctx.tui.invalidate();
      return true;
    case 'done':
    case 'turn_finished':
      stopSpinner(ctx);
      ctx.eventRegistry.handle(event as any, ctx.eventState, ctx.extensionRegistry);
      ctx.tui.invalidate();
      return true;
    case 'aborted':
      stopSpinner(ctx);
      process.exitCode = 130;
      return false;
  }

  const comp = ctx.eventRegistry.handle(event as any, ctx.eventState, ctx.extensionRegistry);
  if (comp) {
    addToChatView(ctx, comp);
    if (kind === 'handoff' || kind === 'tool' || kind === 'history_message') {
      ctx.chatView.addSpacer();
    }
  }
  if (kind === 'handoff') updateStatusLine(ctx);

  ctx.tui.invalidate();
  return true;
}

function stopSpinner(ctx: ChatCtx): void {
  if (ctx.spinnerActive) {
    setSpinner(ctx, false);
  }
}

function handleStatusEvent(ctx: ChatCtx, event: unknown): void {
  const phase = (event as any).phase ?? '';
  if (phase === 'thinking' && !ctx.spinnerActive) {
    ctx.spinner.setMessage(formatThinkingMessage(ctx.eventState.currentAgent));
    setSpinner(ctx, true);
    ctx.spinner.setVisible(true);
    ctx.spinner.start(() => ctx.tui.invalidate());
  } else if (phase === 'complete') {
    stopSpinner(ctx);
  }
}

function handleAgentInfoEvent(ctx: ChatCtx, event: unknown): void {
  ctx.eventRegistry.handle(event as any, ctx.eventState, ctx.extensionRegistry);
  if (ctx.eventState.currentAgent) {
    ctx.headerBar.setAgent(ctx.eventState.currentAgent);
    if (ctx.spinnerActive) {
      ctx.spinner.setMessage(formatThinkingMessage(ctx.eventState.currentAgent));
    }
  }
  updateStatusLine(ctx);
  ctx.tui.invalidate();
}

function handleSubworkflowStart(ctx: ChatCtx, event: unknown): void {
  const payload = event as any;
  if (payload.agentName) {
    ctx.eventState.currentAgentId = payload.agentId ?? ctx.eventState.currentAgentId;
    ctx.eventState.currentAgent = resolveAgentDisplay({
      name: payload.agentName,
      avatarColor: payload.avatarColor,
      model: payload.llmModel,
    });
    ctx.headerBar.setAgent(ctx.eventState.currentAgent);
  }
  ctx.eventState.currentThinking?.collapse();
  ctx.eventState.currentThinking = null;
  ctx.eventState.currentResponse = null;
  updateStatusLine(ctx);
  ctx.tui.invalidate();
}

function formatThinkingMessage(agent: WorkflowEventState['currentAgent']): string {
  if (!agent) return 'Agent is thinking…';
  const { r, g, b } = agent.color;
  return `\x1b[38;2;${r};${g};${b}m${agent.name} is thinking…\x1b[0m`;
}

function handleSubworkflowEnd(ctx: ChatCtx): void {
  ctx.eventState.currentThinking?.collapse();
  ctx.eventState.currentThinking = null;
  ctx.eventState.currentResponse = null;
  ctx.tui.invalidate();
}

function updateStatusLine(
  ctx: Pick<
    ChatCtx,
    'statusLine' | 'eventState' | 'workspaceRoot' | 'gitBranch' | 'sessionId' | 'sessionTitle'
  >
): void {
  const workspace = ctx.gitBranch
    ? `${ctx.workspaceRoot} - ${ctx.gitBranch} -`
    : `${ctx.workspaceRoot} -`;
  ctx.statusLine.setLeft(workspace);

  const right: string[] = [];
  const agent = ctx.eventState.currentAgent;
  if (agent?.name) {
    const color = agent.color;
    const coloredName =
      `\x1b[22m\x1b[38;2;${color.r};${color.g};${color.b}m` + `${agent.name}\x1b[39m\x1b[2m`;
    right.push(agent.model ? `${coloredName} (${agent.model})` : coloredName);
  }
  if (ctx.sessionId) right.push(`session id: ${ctx.sessionId}`);
  ctx.statusLine.setRight(right.join(' - '));
}

async function streamTurn(
  ctx: ChatCtx,
  client: ICliCommandClient,
  requestCommand: string,
  turnPayload: Record<string, unknown>,
  workspaceRoot: string,
  signal: AbortSignal
): Promise<boolean> {
  for await (const event of client.streamInteraction(
    { command: requestCommand, payload: turnPayload },
    { workspaceRoot, invocationSurface: 'cli' as const, calledByHuman: true, signal }
  )) {
    if ((event as any).kind === 'error') {
      const msg = (event as any).message ?? '';
      if (isAbortLikeError(msg)) return false;
      throw new Error(msg);
    }

    if (!handleStreamEvent(ctx, event)) {
      return false;
    }
  }

  return true;
}

async function promptForMessage(ctx: ChatCtx, signal: AbortSignal): Promise<string> {
  const promptText = '\x1b[1m>\x1b[0m ';

  // Create new prompt that resolves the returned promise
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Chat input aborted'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    const prompt = new Prompt(
      promptText,
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      ctx.slashCommands
    );
    ctx.prompt = prompt;
    ctx.layout.setPrompt(prompt);
    ctx.tui.setFocused(ctx.layout);
    ctx.tui.invalidate();
  });
}

export async function renderChat(
  client: ICliCommandClient,
  agentId: string | undefined,
  options: ChatOptions,
  _mediatorLog: boolean = false,
  resolveProjectName?: (workspaceRoot: string) => Promise<string | undefined>,
  requestCommand: string = 'chat-chat',
  requestPayload?: Record<string, unknown>,
  dependencies: ChatTuiDependencies = {}
): Promise<void> {
  const workspaceRoot = findWorkspaceRoot();
  const abortControl = setupAbortController();

  const ctx = buildChatCtx(
    requestPayload,
    dependencies.terminal ?? new ProcessTerminal(),
    workspaceRoot
  );

  dependencies.questionService?.setLifecycleHooks({
    beforeQuestion: () => ctx.tui.stop(),
    afterQuestion: () => {
      ctx.tui.start();
      ctx.tui.invalidate();
    },
  });

  ctx.tui.start();
  let exitRequested = false;

  try {
    if (!options.oneShot && requestCommand === 'chat-chat' && agentId) {
      const startupOk = await streamTurn(
        ctx,
        client,
        'chat-chat-startup',
        {
          employeeId: agentId,
          options: {
            sessionId: options.sessionId,
            createNewSession: options.createNewSession,
            introduction: true,
          },
        },
        workspaceRoot,
        abortControl.signal
      );
      if (!startupOk) return;
    }

    const interactiveLoop = !options.oneShot && options.message === undefined;
    let message: string | null | undefined = options.message;

    while (true) {
      message = await getNextMessage(ctx, options, message, abortControl.signal);
      if (message === null) {
        exitRequested = true;
        break;
      }
      if (!message) {
        message = await promptForMessage(ctx, abortControl.signal);
        if (!message) continue;
      }

      const userMessage = new UserMessage(message, ctx.eventState.developerName);
      ctx.eventState.currentUserMessage = userMessage;
      addToChatView(ctx, userMessage);
      ctx.chatView.addSpacer();
      ctx.tui.invalidate();

      const turnPayload = buildTurnPayload(ctx, requestPayload, agentId, options, message);
      const ok = await streamTurn(
        ctx,
        client,
        requestCommand,
        turnPayload,
        workspaceRoot,
        abortControl.signal
      );

      if (!ok || options.oneShot || !interactiveLoop) break;
      message = undefined;
    }
  } catch (error) {
    if (abortControl.wasAborted() || isAbortLikeError(error)) {
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    dependencies.questionService?.setLifecycleHooks();
    stopSpinner(ctx);
    ctx.tui.stop();
    abortControl.dispose();
  }

  if (exitRequested) {
    const resolvedName = await resolveProjectNameFromWorkspace(workspaceRoot, resolveProjectName);
    const team = resolvedName ? `the ${resolvedName} team` : 'the team';
    const lines = [`See you next time — ${team} will be here when you need us 👋`, ''];
    if (ctx.sessionId) {
      lines.push(`Resume this session: ait chat ${ctx.sessionId}`);
    }
    lines.push('Return to your last session: ait chat');
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}

async function resolveProjectNameFromWorkspace(
  workspaceRoot: string,
  resolver?: (workspaceRoot: string) => Promise<string | undefined>
): Promise<string | undefined> {
  if (resolver) return resolver(workspaceRoot);

  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const pkg = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return pkg.name;
  } catch {
    return undefined;
  }
}

async function getNextMessage(
  ctx: ChatCtx,
  options: ChatOptions,
  currentMessage: string | null | undefined,
  signal: AbortSignal
): Promise<string | null | undefined> {
  if (!options.oneShot && !currentMessage?.trim()) {
    currentMessage = await promptForMessage(ctx, signal);
  }

  if (!currentMessage?.trim()) return undefined;

  const trimmed = currentMessage.toLowerCase();
  if (['exit', '/exit', 'quit', '/quit', 'q', '/q'].includes(trimmed)) {
    return null;
  }

  return currentMessage;
}

function buildTurnPayload(
  ctx: Pick<ChatCtx, 'eventState' | 'sessionId'>,
  requestPayload: Record<string, unknown> | undefined,
  agentId: string | undefined,
  options: ChatOptions,
  message: string
): Record<string, unknown> {
  if (requestPayload) {
    const { __slashSuggestions: _slashSuggestions, ...servicePayload } = requestPayload;
    return {
      ...servicePayload,
      agentId: ctx.eventState.currentAgentId ?? servicePayload['agentId'],
      sessionId: ctx.sessionId ?? servicePayload['sessionId'],
      message,
    };
  }
  return {
    agentId: ctx.eventState.currentAgentId ?? agentId,
    message,
    sessionId: ctx.sessionId ?? options.sessionId,
    createNewSession: options.createNewSession,
  };
}
