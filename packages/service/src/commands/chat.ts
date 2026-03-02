/**
 * Chat command - chat with an agent using the configured LLM
 * Supports live agent switching when user asks to be forwarded.
 * Supports explicit slash commands and direct tool calls.
 */

import { exec } from 'child_process';
import ora from 'ora';
import fs from 'fs/promises';
import { format as formatMessage, promisify } from 'util';
import {
  AgentManager,
  ChatManager,
  ChatMessage,
  Agent,
  ContextLevel,
  LlmService,
  RoleType,
  SkillManager,
  loadSkill,
  loadTeamConfig,
  ALL_TOOLS,
  getAgentTools,
  executeAgentTool,
  type ToolExecutionResult,
} from '@ai-team/core';
import type { ChatCompletionMessageParam, LlmChatOptions } from '@ai-team/core';
import { listEmployeesCommand } from './list.js';
import { hireCommand } from './hire.js';
import { resolveEmployeesCommand } from './info.js';
import { fireCommand } from './fire.js';
import { createCommand } from './create.js';
import { initCommand } from './init.js';
import { hhRefreshCommand } from './hh.js';
import { testConnectionCommand } from './test-connection.js';
import { getTeamGraphCommand } from './graph.js';
import type {
  ChatOptions,
  MediatorRuntimeEvent,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '../contracts.js';
import { getGitUserName, developerNameToId } from '../utils/git.js';
import { ensureUserEnvVars as ensureServiceUserEnvVars } from '../utils/user-env.js';
import { SessionManager } from '../session-manager.js';
import { createSqliteStorage } from '../storage/index.js';

const execAsync = promisify(exec);
const CHAT_CONNECT_TIMEOUT_MS = 20_000;
const GREETING_TIMEOUT_MS = 12_000;
const PREFLIGHT_STEP_TIMEOUT_MS = 15_000;

interface SendResult {
  switchedTo?: Agent;
  handoffMessage?: string;
}

interface HandoffMeta {
  fromAgentId: string;
  note: string;
}

function extractStreamDeltaText(chunk: { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }> }): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) {
    return '';
  }

  const content = extractDeltaSegmentText(delta.content);
  if (content) {
    return content;
  }

  return extractDeltaSegmentText(delta.reasoning_content);
}

function extractDeltaSegmentText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') {
        return text;
      }
      const nestedContent = (part as { content?: unknown }).content;
      return typeof nestedContent === 'string' ? nestedContent : '';
    })
    .join('');
}

export interface ChatRuntimeHooks {
  signal?: AbortSignal;
  emit?: (event: MediatorRuntimeEvent) => void;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

function emitRuntimeEvent(hooks: ChatRuntimeHooks | undefined, event: MediatorRuntimeEvent): void {
  hooks?.emit?.(event);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function withAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  abortMessage: string,
): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throw new Error(abortMessage);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error(abortMessage));
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise
      .then((value) => {
        cleanup();
        resolve(value);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|abort/i.test(message);
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) {
    throw new Error(message);
  }
}

async function tryGreetUser(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: import('@ai-team/core').Skill | undefined,
  developerName: string | undefined,
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
): Promise<void> {
  try {
    await withAbortSignal(
      withTimeout(
        greetUser(llm, chatManager, agentManager, agent, history, skill, developerName, hooks, sessionManager, sessionId),
        GREETING_TIMEOUT_MS,
        `Greeting timed out after ${GREETING_TIMEOUT_MS / 1000}s.`,
      ),
      hooks?.signal,
      'Chat greeting aborted by user.',
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    writeWarn(hooks, 'Greeting skipped due to slow LLM response. You can start typing now.');
  }
}

async function runPreflightStep<T>(
  hooks: ChatRuntimeHooks | undefined,
  message: string,
  task: () => Promise<T>,
  timeoutMs: number = PREFLIGHT_STEP_TIMEOUT_MS,
): Promise<T> {
  writeInfo(hooks, message);
  return withAbortSignal(
    withTimeout(task(), timeoutMs, `${message} timed out after ${Math.floor(timeoutMs / 1000)}s.`),
    hooks?.signal,
    `${message} aborted by user.`,
  );
}

function resolveWorkflowAnswer(
  hooks: ChatRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } },
): QuestionAnswerValue | undefined {
  const workflowId = request.workflow?.workflowId;
  const questionId = request.workflow?.questionId;
  if (!workflowId || !questionId) {
    return undefined;
  }

  if (hooks?.workflowState?.workflowId !== workflowId) {
    return undefined;
  }

  return hooks.workflowState.answers[questionId];
}

function emitWorkflowQuestionFrame(
  hooks: ChatRuntimeHooks | undefined,
  request:
    | ({ kind: 'input' } & QuestionInputRequest)
    | ({ kind: 'confirm' } & QuestionConfirmRequest)
    | ({ kind: 'select' } & QuestionSelectRequest)
    | ({ kind: 'password' } & QuestionPasswordRequest)
    | ({ kind: 'checklist' } & QuestionChecklistRequest),
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) {
    return;
  }

  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request,
  });
}

function emitWorkflowResultFrame(
  hooks: ChatRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; stepId?: string; continuationToken?: string; questionId?: string } },
  result: QuestionAnswerValue,
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) {
    return;
  }

  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request.workflow?.questionId
      ? {
          kind: 'input',
          message: '',
          workflow: request.workflow,
        }
      : undefined,
    result,
  });
}

async function requestInput(hooks: ChatRuntimeHooks | undefined, request: QuestionInputRequest): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'input', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'input',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no client questionInput responder is available.');
  }

  await Promise.resolve();
  const answer = await hooks.questionInput!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

async function requestConfirm(hooks: ChatRuntimeHooks | undefined, request: QuestionConfirmRequest): Promise<boolean> {
  emitWorkflowQuestionFrame(hooks, { kind: 'confirm', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'confirm',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'boolean') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionConfirm) {
    throw new Error('Confirm question requested but no client questionConfirm responder is available.');
  }

  await Promise.resolve();
  const answer = await hooks.questionConfirm!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

async function requestSelect(hooks: ChatRuntimeHooks | undefined, request: QuestionSelectRequest): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'select', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'select',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionSelect) {
    if (hooks?.questionInput) {
      const choiceLines = request.choices
        .map((choice, index) => `${index + 1}. ${choice.name}`)
        .join('\n');

      await Promise.resolve();
      const answer = await hooks.questionInput!({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
        workflow: request.workflow,
        validate: (value: string) => {
          const resolved = resolveSelectAnswer(value, request.choices);
          return resolved ? true : 'Please enter a valid option number, name, or value.';
        },
      });

      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) {
        throw new Error('Invalid selection answer for select question.');
      }

      emitWorkflowResultFrame(hooks, request, resolved);
      return resolved;
    }

    throw new Error('Select question requested but no client questionSelect or compatible questionInput responder is available.');
  }

  await Promise.resolve();
  const answer = await hooks.questionSelect!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

function resolveSelectAnswer(input: string, choices: Array<{ name: string; value: string }>): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  const exactValue = choices.find(choice => choice.value.toLowerCase() === trimmed.toLowerCase());
  if (exactValue) {
    return exactValue.value;
  }

  const exactName = choices.find(choice => choice.name.toLowerCase() === trimmed.toLowerCase());
  if (exactName) {
    return exactName.value;
  }

  return undefined;
}

async function requestPassword(hooks: ChatRuntimeHooks | undefined, request: QuestionPasswordRequest): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'password', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'password',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionPassword) {
    throw new Error('Password question requested but no client questionPassword responder is available.');
  }

  await Promise.resolve();
  const answer = await hooks.questionPassword!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

async function requestChecklist(hooks: ChatRuntimeHooks | undefined, request: QuestionChecklistRequest): Promise<string[]> {
  emitWorkflowQuestionFrame(hooks, { kind: 'checklist', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'checklist',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (Array.isArray(resumed) && resumed.every(item => typeof item === 'string')) {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionChecklist) {
    throw new Error('Checklist question requested but no client questionChecklist responder is available.');
  }

  await Promise.resolve();
  const answer = await hooks.questionChecklist!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

interface InteractiveQuestionToolArgs {
  question: string;
  questionType?: 'input' | 'confirm' | 'select' | 'checklist' | 'password';
  context?: string;
  choices?: Array<{ name: string; value: string }>;
  default?: unknown;
  mask?: string;
  allowEmpty?: boolean;
}

function isInteractiveQuestionTool(toolName: string): boolean {
  return toolName === 'ask_human' || toolName === 'ask_question';
}

function parseInteractiveQuestionToolArgs(args: unknown): { ok: true; value: InteractiveQuestionToolArgs } | { ok: false; error: string } {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'ask_human expects an object payload.' };
  }

  const raw = args as Record<string, unknown>;
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (!question) {
    return { ok: false, error: 'ask_human requires a non-empty question field.' };
  }

  const questionType = typeof raw.questionType === 'string'
    ? raw.questionType
    : 'input';

  const normalizedType = ['input', 'confirm', 'select', 'checklist', 'password'].includes(questionType)
    ? questionType as InteractiveQuestionToolArgs['questionType']
    : undefined;

  if (!normalizedType) {
    return { ok: false, error: `Unsupported questionType '${String(questionType)}'.` };
  }

  const choices = Array.isArray(raw.choices)
    ? raw.choices
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return undefined;
          }
          const choiceRecord = entry as Record<string, unknown>;
          const name = typeof choiceRecord.name === 'string' ? choiceRecord.name : undefined;
          const value = typeof choiceRecord.value === 'string' ? choiceRecord.value : undefined;
          if (!name || !value) {
            return undefined;
          }
          return { name, value };
        })
        .filter((entry): entry is { name: string; value: string } => Boolean(entry))
    : undefined;

  if ((normalizedType === 'select' || normalizedType === 'checklist') && (!choices || choices.length === 0)) {
    return { ok: false, error: `questionType '${normalizedType}' requires a non-empty choices array.` };
  }

  const context = typeof raw.context === 'string' ? raw.context : undefined;
  const allowEmpty = typeof raw.allowEmpty === 'boolean' ? raw.allowEmpty : undefined;
  const mask = typeof raw.mask === 'string' ? raw.mask : undefined;

  return {
    ok: true,
    value: {
      question,
      questionType: normalizedType,
      context,
      choices,
      default: raw.default,
      allowEmpty,
      mask,
    },
  };
}

async function executeInteractiveQuestionTool(
  toolName: string,
  args: unknown,
  hooks: ChatRuntimeHooks | undefined,
): Promise<ToolExecutionResult> {
  const parsed = parseInteractiveQuestionToolArgs(args);
  if (!parsed.ok) {
    return {
      ok: false,
      toolName,
      error: parsed.error,
    };
  }

  const { question, questionType = 'input', context, choices, default: defaultValue, allowEmpty, mask } = parsed.value;
  const message = context ? `${question}\n\nContext: ${context}` : question;

  switch (questionType) {
    case 'confirm': {
      const answer = await requestConfirm(hooks, {
        message,
        default: typeof defaultValue === 'boolean' ? defaultValue : false,
      });
      return {
        ok: true,
        toolName,
        result: { question, questionType, answer },
      };
    }
    case 'select': {
      const answer = await requestSelect(hooks, {
        message,
        choices: choices as Array<{ name: string; value: string }>,
      });
      return {
        ok: true,
        toolName,
        result: { question, questionType, answer },
      };
    }
    case 'checklist': {
      const answer = await requestChecklist(hooks, {
        message,
        choices: choices as Array<{ name: string; value: string }>,
      });
      return {
        ok: true,
        toolName,
        result: { question, questionType, answer },
      };
    }
    case 'password': {
      const answer = await requestPassword(hooks, {
        message,
        mask,
      });
      return {
        ok: true,
        toolName,
        result: { question, questionType, answer },
      };
    }
    case 'input':
    default: {
      const answer = await requestInput(hooks, {
        message,
        validate: allowEmpty
          ? undefined
          : (value: string) => value.trim().length > 0 || 'Please provide a value.',
      });
      return {
        ok: true,
        toolName,
        result: { question, questionType, answer },
      };
    }
  }
}

function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) {
    return '';
  }

  if (typeof args[0] === 'string') {
    return formatMessage(args[0], ...args.slice(1));
  }

  return args.map(part => {
    if (typeof part === 'string') {
      return part;
    }

    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join(' ');
}

function writeInfo(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, {
    kind: 'log',
    level: 'info',
    message,
  });

  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeWarn(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, {
    kind: 'log',
    level: 'warn',
    message,
  });

  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeError(hooks: ChatRuntimeHooks | undefined, message: string): void {
  emitRuntimeEvent(hooks, {
    kind: 'log',
    level: 'error',
    message,
  });

  if (!hooks?.emit) {
    process.stderr.write(`${message}\n`);
  }
}

export const CHAT_COMMAND_META = {
  description: 'Start a chat session with an agent (defaults to top-level manager if omitted)',
  llmCallable: false,
};

const IN_CHAT_COMMAND_REGISTRY = [
  { key: 'chat', usage: '/chat <name|role>', description: 'Switch to another employee' },
  { key: 'list', usage: '/list', description: 'List all employees in the team' },
  { key: 'who', usage: '/who', description: 'Show who you are currently talking to' },
  { key: 'hire', usage: '/hire', description: 'Hire a new team member (interactive workflow)' },
  { key: 'overview', usage: '/overview', description: 'Show workspace file overview' },
  { key: 'run', usage: '/run <command>', description: 'Run a shell command and share its output' },
  { key: 'info', usage: '/info <employee>', description: 'Show detailed information about an employee' },
  { key: 'fire', usage: '/fire <employee>', description: 'Fire (delete) an employee and remove their data' },
  { key: 'create', usage: '/create [employee|skill]', description: 'Create a new team member or role' },
  { key: 'hh', usage: '/hh refresh', description: 'Scout and refresh skill catalog from GitHub' },
  { key: 'test-connection', usage: '/test-connection', description: 'Test LLM provider/model connectivity' },
  { key: 'init', usage: '/init', description: 'Initialize AI Team in current workspace' },
  { key: 'history', usage: '/history', description: 'Show recent messages (history 20 for more)' },
  { key: 'portfolio', usage: '/portfolio', description: "Show the employee's portfolio / bio" },
  { key: 'graph', usage: '/graph', description: 'Visualize team graph and reporting structure' },
  { key: 'help', usage: '/help', description: 'Show this help' },
  { key: 'tool', usage: '#<tool> <json>', description: 'Run a direct tool call' },
] as const;

const IN_CHAT_COMMAND_ALIASES: Record<string, string> = {
  shell: 'run',
  bio: 'portfolio',
};

export async function chatCommand(
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  hooks: ChatRuntimeHooks = {},
) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  if (hooks.emit) {
    console.log = (...args: unknown[]) => {
      emitRuntimeEvent(hooks, {
        kind: 'log',
        level: 'info',
        message: formatConsoleArgs(args),
      });
    };

    console.warn = (...args: unknown[]) => {
      emitRuntimeEvent(hooks, {
        kind: 'log',
        level: 'warn',
        message: formatConsoleArgs(args),
      });
    };

    console.error = (...args: unknown[]) => {
      emitRuntimeEvent(hooks, {
        kind: 'log',
        level: 'error',
        message: formatConsoleArgs(args),
      });
    };

    process.stdout.write = ((chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), cb?: (error?: Error | null) => void) => {
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString(typeof encoding === 'string' ? encoding : undefined)
          : String(chunk);

      emitRuntimeEvent(hooks, {
        kind: 'token',
        text,
      });

      if (typeof encoding === 'function') {
        encoding(null);
        return true;
      }
      if (cb) {
        cb(null);
      }
      return true;
    }) as typeof process.stdout.write;
  }

  let sessionManager!: SessionManager;
  let currentSessionId!: string;

  try {
    const agentManager = new AgentManager(workspaceRoot);
    const chatManager = new ChatManager(workspaceRoot);
    const handoffTracker = new Map<string, HandoffMeta>();

    // Always use SQLite sessions (not JSONL files)
    sessionManager = new SessionManager(workspaceRoot, createSqliteStorage(workspaceRoot), agentManager);
    await sessionManager.initialize();

    const loadHistory = async (currentAgentId: string): Promise<ChatMessage[]> => {
      if (options.sessionId) {
        currentSessionId = options.sessionId;
        return sessionManager.getSessionMessages(options.sessionId);
      }
      // Auto-create or resume latest session for this agent
      const latestSession = await sessionManager.getLatestSession(currentAgentId);
      if (latestSession) {
        currentSessionId = latestSession.id;
        return sessionManager.getSessionMessages(latestSession.id);
      }
      // Create new session
      const developerId = developerNameToId(developerName || 'developer');
      const newSession = await sessionManager.createSession(currentAgentId, developerId);
      currentSessionId = newSession.id;
      return [];
    };

    const teamConfig = await runPreflightStep(
      hooks,
      'Loading team configuration...',
      () => loadTeamConfig(workspaceRoot),
    );
    const registry = teamConfig?.providers || teamConfig?.llmProviders;
    const defaultProviderRef = registry
      ? (Object.entries(registry).find(([, cfg]) => cfg.isDefault)?.[0]
        || teamConfig?.defaultLlmProvider
        || Object.keys(registry)[0])
      : undefined;
    const defaultProviderKind = defaultProviderRef ? registry?.[defaultProviderRef]?.kind : undefined;
    const requiresApiKey = defaultProviderKind
      ? defaultProviderKind === 'openai-compatible'
      : teamConfig?.llm?.provider === 'openai-compatible';
    const env = await runPreflightStep(
      hooks,
      'Validating user environment...',
      () => ensureServiceUserEnvVars(
        workspaceRoot,
        { developerName: true, apiKey: requiresApiKey },
        { quiet: true },
      ),
    );
    const developerName = resolveDeveloperName(env) ?? getGitUserName();

    await runPreflightStep(
      hooks,
      'Initializing agents...',
      () => agentManager.initialize(),
    );

    let resolvedAgent: Agent | undefined;

    if (!agentId || agentId.trim().length === 0) {
      const all = agentManager.getAllAgents();
      resolvedAgent = selectDefaultTopAgent(all);
      if (!resolvedAgent) {
        writeError(hooks, 'No agents found in this workspace.');
        writeInfo(hooks, 'Run ait init to initialize your team.');
        throw new Error('No agents found in this workspace. Run ait init to initialize your team.');
      }
      writeInfo(hooks, `No agent specified; defaulting to ${resolvedAgent.name} (${resolvedAgent.role}).`);
    } else {
      const matches = agentManager.resolveAgent(agentId);

      if (matches.length === 0) {
        writeError(hooks, `Agent not found: "${agentId}"`);
        const all = agentManager.getAllAgents();
        if (all.length > 0) {
          writeInfo(hooks, '');
          writeInfo(hooks, 'Available agents:');
          for (const a of all) {
            writeInfo(hooks, `  - ${a.name} (${a.role}) [id: ${a.id}]`);
          }
        }
        writeInfo(hooks, '');
        writeInfo(hooks, 'Run ait list to see all agents.');
        throw new Error(`Agent not found: "${agentId}"`);
      } else if (matches.length === 1) {
        resolvedAgent = matches[0];
      } else {
        const chosen = await requestSelect(hooks, {
          message: `Multiple agents match "${agentId}". Which one?`,
          choices: matches.map(a => ({
            name: `${a.name} — ${a.role} [${a.id}]`,
            value: a.id,
          })),
        });
        resolvedAgent = agentManager.getAgent(chosen);
      }
    }

    if (!resolvedAgent) {
      writeError(hooks, 'Could not resolve agent.');
      throw new Error('Could not resolve agent.');
    }

    let agent: Agent = resolvedAgent;

    // Initialize LLM service
    const llm = new LlmService(workspaceRoot);
    const useSpinner = !hooks?.emit && Boolean(process.stderr.isTTY);
    const spinner = useSpinner ? ora('Connecting to LLM...').start() : undefined;
    if (!spinner) {
      writeInfo(hooks, 'Connecting to LLM...');
    }
    try {
      await withAbortSignal(
        withTimeout(
          llm.initialize(),
          CHAT_CONNECT_TIMEOUT_MS,
          `LLM initialization timed out after ${CHAT_CONNECT_TIMEOUT_MS / 1000}s.`,
        ),
        hooks?.signal,
        'Chat connection aborted by user.',
      );
      if (spinner) {
        spinner.succeed(`Connected to ${llm.provider} using ${llm.modelName}`);
      } else {
        writeInfo(hooks, `Connected to ${llm.provider} using ${llm.modelName}`);
      }
    } catch (error) {
      if (spinner) {
        spinner.fail('Could not connect to configured LLM');
      }
      writeError(hooks, (error as Error).message);
      writeInfo(hooks, 'Run "ait test-connection" to debug, or "ait init" to configure provider.');
      throw new Error((error as Error).message);
    }

    // Load skill instructions for the agent's role
    let skill;
    try {
      skill = await loadSkill(agent.skillPath);
    } catch {
      // Skill file may not exist — that's fine, agent bio is still used
    }

    writeInfo(hooks, `\nChat with ${agent.name} (${agent.role})`);
    writeInfo(hooks, 'Type "exit" to end the conversation');
    writeInfo(hooks, 'Type "/help" to see available in-chat commands');
    writeInfo(hooks, 'Ask to be forwarded or type "/chat <name>" to switch agents');
    writeInfo(hooks, 'Use "#tool_name {json}" or "/tool tool_name {json}" for direct tool calls');

    // Load chat history
    let history = await loadHistory(agent.id);
    if (history.length > 0) {
      writeInfo(hooks, `(${history.length} previous messages loaded)`);
    }

    // Agent greets the user on first contact
    if (history.length === 0) {
      await tryGreetUser(llm, chatManager, agentManager, agent, history, skill, developerName, hooks, sessionManager, currentSessionId);
    }

    // Single message mode
    if (options.message) {
      const result = await withAbortSignal(
        sendMessage(
          llm,
          chatManager,
          agentManager,
          agent,
          history,
          options.message,
          skill,
          options.context,
          handoffTracker,
          developerName,
          hooks,
          sessionManager,
          currentSessionId,
        ),
        hooks.signal,
        'Chat request aborted by user.',
      );
      if (result.switchedTo) {
        const fromAgent = agent;
        agent = result.switchedTo;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await loadHistory(agent.id);
        if (result.handoffMessage) {
          const handoffMessage: ChatMessage = {
            timestamp: new Date().toISOString(),
            from: fromAgent.id,
            content: result.handoffMessage,
          };
          if (sessionManager && currentSessionId) {
            await sessionManager.appendMessage(currentSessionId, handoffMessage);
          }
          history.push(handoffMessage);
          writeInfo(hooks, `  Handoff note ${fromAgent.name} (${fromAgent.role}): ${result.handoffMessage}`);
          writeInfo(hooks, '');
          handoffTracker.set(agent.id, {
            fromAgentId: fromAgent.id,
            note: result.handoffMessage,
          });
          // Emit handoff event to notify clients
          emitRuntimeEvent(hooks, {
            kind: 'handoff',
            fromAgentId: fromAgent.id,
            toAgentId: agent.id,
            handoffNote: result.handoffMessage,
            message: `Handed off from ${fromAgent.name} to ${agent.name}`,
          });
          await acknowledgeHandoff(
            llm,
            chatManager,
            agentManager,
            agent,
            history,
            skill,
            fromAgent,
            result.handoffMessage,
            hooks,
            sessionManager,
            currentSessionId,
          );
        }
      }
      if (options.oneShot) {
        return;
      }
    }

    // Interactive chat loop — supports commands and live agent switching
    while (true) {
      throwIfAborted(hooks.signal, 'Chat request aborted by user.');

      const message = await withAbortSignal(
        requestInput(hooks, {
          message: formatUserPrompt(agent),
          validate: (val: string) => val.length > 0 || 'Message cannot be empty',
        }),
        hooks.signal,
        'Chat input aborted by user.',
      );

      if (message.toLowerCase() === 'exit') {
        writeInfo(hooks, 'Goodbye!');
        break;
      }

      // ── In-chat command dispatch ──────────────────────────────────
      const trimmedMessage = message.trim();
      const cmd = parseInChatCommand(trimmedMessage);
      const looksLikeDirectTool = isDirectToolSyntax(trimmedMessage);
      if (trimmedMessage.startsWith('/') && !cmd && !looksLikeDirectTool) {
        writeWarn(hooks, 'Unknown slash command. Type /help to see available commands.');
        writeInfo(hooks, '');
        continue;
      }

      if (cmd) {
        if (cmd.name === 'help') {
          printChatHelp();
          continue;
        }

        if (cmd.name === 'list') {
          await printEmployeesList(workspaceRoot, {});
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'who') {
          printCurrentChatTarget(agent);
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'hire') {
          await hireCommand(workspaceRoot, {});
          // Reload agents after hire
          await agentManager.loadAllAgents();
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'info') {
          await printEmployeeInfo(workspaceRoot, cmd.args || agent.id);
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'fire') {
          if (!cmd.args) {
            writeWarn(hooks, 'Usage: fire <name|id|role>');
            writeInfo(hooks, '');
            continue;
          }
          await fireCommand(workspaceRoot, cmd.args, {});
          await agentManager.loadAllAgents();
          const activeAgentId = agent?.id;
          if (activeAgentId && agentManager.getAllAgents().every(a => a.id !== activeAgentId)) {
            const fallback = agentManager.getAllAgents()[0];
            if (fallback) {
              agent = fallback;
              try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
              history = await loadHistory(agent.id);
            }
          }
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'create') {
          const type = (cmd.args || 'agent').split(/\s+/)[0];
          await createCommand(workspaceRoot, type, { interactive: true });
          await agentManager.loadAllAgents();
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'hh') {
          const sub = (cmd.args || '').trim().toLowerCase();
          if (sub === 'refresh') {
            await hhRefreshCommand(workspaceRoot);
          } else {
            writeWarn(hooks, 'Usage: hh refresh');
          }
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'test-connection') {
          await testConnectionCommand(workspaceRoot, {});
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'init') {
          await initCommand(workspaceRoot, {});
          await agentManager.loadAllAgents();
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'overview') {
          const overview = await getWorkspaceOverview(workspaceRoot);
          writeInfo(hooks, '\nWorkspace Overview\n');
          writeInfo(hooks, overview);
          await appendToolOutputToHistory(chatManager, history, agent.id, 'overview', overview, sessionManager, currentSessionId);
          writeInfo(hooks, `  (Shared overview output with ${agent.name} for future context.)`);
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'run' || cmd.name === 'shell') {
          if (!cmd.args) {
            writeWarn(hooks, 'Usage: run <command>');
            writeInfo(hooks, '');
            continue;
          }
          await runShellCommand(cmd.args, workspaceRoot, chatManager, history, agent, hooks, sessionManager, currentSessionId);
          writeInfo(hooks, '');
          continue;
        }

        if (cmd.name === 'chat' && cmd.args) {
          const parsed = parseChatSwitchArgs(cmd.args);
          const target = await resolveSwitch(parsed.targetQuery, agentManager, agent.id, hooks);
          if (target) {
            const fromAgent = agent;
            agent = target;
            try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
            history = await loadHistory(agent.id);

            if (parsed.handoffMessage) {
              await appendHandoffNote(chatManager, history, agent.id, fromAgent, parsed.handoffMessage, sessionManager, currentSessionId);
              handoffTracker.set(agent.id, {
                fromAgentId: fromAgent.id,
                note: parsed.handoffMessage,
              });
            }

            writeInfo(hooks, `\nSwitched to ${agent.name} (${agent.role})`);
            if (history.length > 0) {
              writeInfo(hooks, `(${history.length} previous messages loaded)`);
            }

            if (parsed.handoffMessage) {
              writeInfo(hooks, `  Handoff note ${fromAgent.name} (${fromAgent.role}): ${parsed.handoffMessage}`);
              writeInfo(hooks, '');
              await acknowledgeHandoff(
                llm,
                chatManager,
                agentManager,
                agent,
                history,
                skill,
                fromAgent,
                parsed.handoffMessage,
                hooks,
                sessionManager,
                currentSessionId,
              );
            }

            const shouldGreet = history.length === 0 && !parsed.handoffMessage;
            if (shouldGreet) {
              await tryGreetUser(llm, chatManager, agentManager, agent, history, skill, developerName, hooks, sessionManager, currentSessionId);
            }
          } else {
            writeError(hooks, `Agent not found: "${parsed.targetQuery}"`);
            const all = agentManager.getAllAgents();
            if (all.length > 0) {
              writeInfo(hooks, 'Available agents:');
              for (const a of all) {
                writeInfo(hooks, `  - ${a.name} (${a.role}) [id: ${a.id}]`);
              }
            }
            writeInfo(hooks, '');
          }
          continue;
        }

        if (cmd.name === 'history') {
          printHistory(history, agent, cmd.args);
          continue;
        }

        if (cmd.name === 'portfolio' || cmd.name === 'bio') {
          await printPortfolio(agent);
          continue;
        }

        if (cmd.name === 'graph') {
          try {
            const graphData = await getTeamGraphCommand(workspaceRoot, 'hierarchy');
            writeInfo(hooks, '\nTeam Graph (hierarchy view)\n');
            writeInfo(hooks, `Nodes: ${graphData.nodes.length}`);
            writeInfo(hooks, `Edges: ${graphData.edges.length}`);
            writeInfo(hooks, '');
            printGraphHierarchy(graphData, hooks);
          } catch (err) {
            writeError(hooks, `Failed to generate graph: ${err instanceof Error ? err.message : String(err)}`);
          }
          writeInfo(hooks, '');
          continue;
        }

        // Parsed but no handler matched — warn instead of silently sending to LLM
        writeWarn(hooks, `Command "/${cmd.name}" is recognized but not available in this context. Type /help to see available commands.`);
        writeInfo(hooks, '');
        continue;
      }

      // ── Natural language forward detection ────────────────────────
      const switchTarget = detectForwardRequest(message, agentManager, agent.id);
      if (switchTarget) {
        writeInfo(hooks, `\nSwitching from ${agent.name} (${agent.role}) to ${switchTarget.name} (${switchTarget.role})...`);
        agent = switchTarget;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await loadHistory(agent.id);
        writeInfo(hooks, `Chat with ${agent.name} (${agent.role})`);
        if (history.length > 0) {
          writeInfo(hooks, `(${history.length} previous messages loaded)`);
        }
        writeInfo(hooks, '');
        // Send a greeting from the new agent
        const handoffResult = await sendMessage(
          llm,
          chatManager,
          agentManager,
          agent,
          history,
          `Hi, I was just forwarded to you from another team member. ${message}`,
          skill,
          options.context,
          handoffTracker,
          developerName,
          hooks,
          sessionManager,
          currentSessionId,
        );

        if (handoffResult.switchedTo) {
          const fromAgent = agent;
          agent = handoffResult.switchedTo;
          try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
          history = await loadHistory(agent.id);
          if (handoffResult.handoffMessage) {
            await appendHandoffNote(chatManager, history, agent.id, fromAgent, handoffResult.handoffMessage, sessionManager, currentSessionId);
            writeInfo(hooks, `  Handoff note ${fromAgent.name} (${fromAgent.role}): ${handoffResult.handoffMessage}`);
            writeInfo(hooks, '');
            handoffTracker.set(agent.id, {
              fromAgentId: fromAgent.id,
              note: handoffResult.handoffMessage,
            });
            // Emit handoff event to notify clients
            emitRuntimeEvent(hooks, {
              kind: 'handoff',
              fromAgentId: fromAgent.id,
              toAgentId: agent.id,
              handoffNote: handoffResult.handoffMessage,
              message: `Handed off from ${fromAgent.name} to ${agent.name}`,
            });
            await acknowledgeHandoff(
              llm,
              chatManager,
              agentManager,
              agent,
              history,
              skill,
              fromAgent,
              handoffResult.handoffMessage,
              hooks,
              sessionManager,
              currentSessionId,
            );
          }
          (sendMessage as any).identitySwitch = true;
          writeInfo(hooks, `Chat with ${agent.name} (${agent.role})`);
          if (history.length > 0) {
            writeInfo(hooks, `(${history.length} previous messages loaded)`);
          }
          writeInfo(hooks, '');
        }
        continue;
      }

      const requestedTarget = extractForwardTargetName(message);
      if (requestedTarget) {
        writeWarn(hooks, `I couldn't find "${requestedTarget}" in your team. Try chat ${requestedTarget} (fuzzy search), or hire them first.`);
        writeInfo(hooks, '');
        continue;
      }

      const result = await withAbortSignal(
        sendMessage(
            llm,
            chatManager,
            agentManager,
            agent,
            history,
          message,
          skill,
          options.context,
          handoffTracker,
          developerName,
          hooks,
          sessionManager,
          currentSessionId,
        ),
        hooks.signal,
        'Chat request aborted by user.',
      );

      if (result.switchedTo) {
        const fromAgent = agent;
        agent = result.switchedTo;
        try { skill = await loadSkill(agent.skillPath); } catch { skill = undefined; }
        history = await loadHistory(agent.id);
        if (result.handoffMessage) {
          await appendHandoffNote(chatManager, history, agent.id, fromAgent, result.handoffMessage, sessionManager, currentSessionId);
          writeInfo(hooks, `  Handoff note ${fromAgent.name} (${fromAgent.role}): ${result.handoffMessage}`);
          writeInfo(hooks, '');
          handoffTracker.set(agent.id, {
            fromAgentId: fromAgent.id,
            note: result.handoffMessage,
          });
          await acknowledgeHandoff(
            llm,
            chatManager,
            agentManager,
            agent,
            history,
            skill,
            fromAgent,
            result.handoffMessage,
            hooks,
            sessionManager,
            currentSessionId,
          );
        }
        (sendMessage as any).identitySwitch = true;
        writeInfo(hooks, `Chat with ${agent.name} (${agent.role})`);
        if (history.length > 0) {
          writeInfo(hooks, `(${history.length} previous messages loaded)`);
        }
        writeInfo(hooks, '');
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      writeInfo(hooks, 'Chat aborted.');
      return;
    }
    writeError(hooks, `Error in chat: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    if (sessionManager) {
      try {
        await sessionManager.close();
      } catch {}
    }

    if (hooks.emit) {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.stdout.write = originalStdoutWrite as typeof process.stdout.write;
    }
  }
}

async function sendMessage(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  message: string,
  skill?: import('@ai-team/core').Skill,
  contextFiles?: string[],
  handoffTracker?: Map<string, HandoffMeta>,
  developerName?: string,
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
): Promise<SendResult> {
  throwIfAborted(hooks?.signal, 'Chat request aborted by user.');

  const slashCommand = parseInChatCommand(message.trim());
  if (slashCommand?.name === 'who') {
    printCurrentChatTarget(agent);
    return {};
  }

  const looksLikeDirectTool = isDirectToolSyntax(message);
  const directToolCall = parseDirectToolCall(message);
  if (directToolCall) {
    await executeDirectToolCall(
      directToolCall,
      chatManager,
      history,
      agent,
      agentManager.workspaceRoot,
      contextFiles,
      hooks,
      sessionManager,
      sessionId,
    );
    return {};
  }

  if (looksLikeDirectTool) {
    return {};
  }

  const llmUpdateRequest = parseEmployeeLlmUpdateRequest(message);
  if (llmUpdateRequest) {
    const previewParts = [
      llmUpdateRequest.model ? `model=${llmUpdateRequest.model}` : undefined,
      llmUpdateRequest.modelKey ? `modelKey=${llmUpdateRequest.modelKey}` : undefined,
      llmUpdateRequest.provider ? `provider=${llmUpdateRequest.provider}` : undefined,
      llmUpdateRequest.temperature !== undefined ? `temperature=${llmUpdateRequest.temperature}` : undefined,
      llmUpdateRequest.maxTokens !== undefined ? `maxTokens=${llmUpdateRequest.maxTokens}` : undefined,
      llmUpdateRequest.topP !== undefined ? `topP=${llmUpdateRequest.topP}` : undefined,
      llmUpdateRequest.presencePenalty !== undefined ? `presencePenalty=${llmUpdateRequest.presencePenalty}` : undefined,
      llmUpdateRequest.frequencyPenalty !== undefined ? `frequencyPenalty=${llmUpdateRequest.frequencyPenalty}` : undefined,
    ].filter(Boolean).join(', ');

    const llmUpdatePrompt = `Allow ${agent.name} to update ${llmUpdateRequest.employee}'s LLM settings (${previewParts || 'profile update'})?`;
    const allowed = await requestConfirm(hooks, {
      message: llmUpdatePrompt,
      default: false,
    });

    if (!allowed) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName: 'update_employee_llm',
        toolPhase: 'denied',
        message: 'LLM profile update canceled by user.',
      });
      writeInfo(hooks, 'LLM profile update canceled by user.');
      return {};
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName: 'update_employee_llm',
      toolPhase: 'start',
      message: 'Executing employee LLM update tool',
    });

    const execution = await executeAgentTool(
      {
        toolName: 'update_employee_llm',
        params: llmUpdateRequest,
        context: {
          agent,
          workspaceRoot: agentManager.workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName: 'update_employee_llm',
        toolPhase: 'error',
        message: execution.error || 'Unknown error',
      });
      writeError(hooks, `Failed to update employee LLM profile: ${execution.error || 'Unknown error'}`);
      return {};
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName: 'update_employee_llm',
      toolPhase: 'result',
      message: 'Employee LLM settings updated',
    });

    const payload = execution.result as { employee?: string; llm?: unknown };
    const target = payload.employee || llmUpdateRequest.employee;
    const responseText = `Updated LLM settings for ${target}.`;

    process.stdout.write(`\n${agent.name} (${agent.role}): `);
    process.stdout.write(responseText + '\n\n');

    const agentMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: responseText,
    };
    if (sessionManager && sessionId) {
      await sessionManager.appendMessage(sessionId, agentMessage);
    }
    history.push(agentMessage);
    await appendToolOutputToHistory(
      chatManager,
      history,
      agent.id,
      'update_employee_llm',
      stringifyToolPayload(payload.llm),
    );
    await agentManager.recordInteraction(agent.id);
    return {};
  }

  const cliGrantRequest = parseCliGrantRequest(message);
  if (cliGrantRequest) {
    const cliGrantPrompt = `Allow ${agent.name} to grant '${cliGrantRequest.command}' to ${cliGrantRequest.employee}?`;
    const allowed = await requestConfirm(hooks, {
      message: cliGrantPrompt,
      default: false,
    });

    if (!allowed) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName: 'register_cli_tool',
        toolPhase: 'denied',
        message: 'CLI tool grant canceled by user.',
      });
      const denied = 'CLI tool grant canceled by user.';
      writeInfo(hooks, denied);
      return {};
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName: 'register_cli_tool',
      toolPhase: 'start',
      message: 'Executing CLI tool grant',
    });

    const execution = await executeAgentTool(
      {
        toolName: 'register_cli_tool',
        params: {
          command: cliGrantRequest.command,
          employee: cliGrantRequest.employee,
        },
        context: {
          agent,
          workspaceRoot: agentManager.workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName: 'register_cli_tool',
        toolPhase: 'error',
        message: execution.error || 'Unknown error',
      });
      writeError(hooks, `Failed to grant CLI tool: ${execution.error || 'Unknown error'}`);
      return {};
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName: 'register_cli_tool',
      toolPhase: 'result',
      message: 'CLI tool granted',
    });

    const payload = execution.result as { employee?: string; command?: string; cliTools?: string[] };
    const target = payload.employee || cliGrantRequest.employee;
    const command = payload.command || cliGrantRequest.command;
    const responseText = `Granted CLI tool '${command}' to ${target}. Allowed CLI tools now: ${(payload.cliTools || []).join(', ') || command}.`;

    process.stdout.write(`\n${agent.name} (${agent.role}): `);
    process.stdout.write(responseText + '\n\n');

    const agentMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: responseText,
    };
    if (sessionManager && sessionId) {
      await sessionManager.appendMessage(sessionId, agentMessage);
    }
    history.push(agentMessage);
    await appendToolOutputToHistory(
      chatManager,
      history,
      agent.id,
      'register_cli_tool',
      stringifyToolPayload(execution.result),
    );
    await agentManager.recordInteraction(agent.id);
    return {};
  }

  // Save user message
  const developerId = developerName ? developerNameToId(developerName) : 'human';
  const userMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: developerId,
    isHuman: true,
    content: message,
    context: contextFiles,
  };
  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, userMessage);
  }
  history.push(userMessage);

  // Build message array from history
  let messages: ChatCompletionMessageParam[] =
    LlmService.historyToMessages(history, agent.id);

  if (developerName) {
    if (!(sendMessage as any).developerIdentityInjected) {
      (sendMessage as any).developerIdentityInjected = new Set<string>();
    }
    const identityInjected = (sendMessage as any).developerIdentityInjected as Set<string>;
    if (!identityInjected.has(agent.id)) {
      messages.unshift({
        role: 'system',
        content:
          `You are speaking with ${developerName}, the human developer orchestrating this chat. `
          + 'Address them by name, do not confuse them with other agents, '
          + 'and treat any pasted notes as context they are sharing.',
      });
      identityInjected.add(agent.id);
    }
  }

  // If a system identity clarification is requested, inject it as a system message
  if ((sendMessage as any).identitySwitch) {
    messages.unshift({
      role: 'system',
      content: `You are now ${agent.name}, ${agent.role}. The previous agent has handed off this conversation to you. Respond only as ${agent.name}.`,
    });
    // Reset the flag for future calls
    (sendMessage as any).identitySwitch = false;
  }

  const overviewInjected = (sendMessage as any).overviewInjected as Set<string> | undefined;
  if (isArchitectLikeRole(agent.role) && !(overviewInjected?.has(agent.id))) {
    const workspaceOverview = await getWorkspaceOverview(agentManager.workspaceRoot);
    messages.unshift({
      role: 'system',
      content:
        'You are getting an initial workspace snapshot to orient on an existing codebase. '
        + 'Use it to ground your advice and planning. If more detail is needed, ask the user to run `overview` and focus on specific files.\n\n'
        + workspaceOverview,
    });
    if (!(sendMessage as any).overviewInjected) {
      (sendMessage as any).overviewInjected = new Set<string>();
    }
    ((sendMessage as any).overviewInjected as Set<string>).add(agent.id);
  }

  // Stream the response with team roster context
  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(`\n${agent.name} (${agent.role}): `);

  let fullResponse = '';
  let streamedResponse = false;
  let hasVisibleStreamOutput = false;
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await withAbortSignal(
      configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill),
      hooks?.signal,
      'Chat request aborted by user.',
    );

    const streamPlainResponse = async (modelMessages: ChatCompletionMessageParam[]) => {
      const stream = await llm.streamChat(agent, modelMessages, llmOptions, skill, teamRoster);
      streamedResponse = true;
      const iterator = stream[Symbol.asyncIterator]();
      try {
        while (true) {
          const nextChunk = await withAbortSignal(
            iterator.next(),
            hooks?.signal,
            'Chat streaming aborted by user.',
          );
          if (nextChunk.done) {
            break;
          }
          const chunk = nextChunk.value;
          const deltaText = extractStreamDeltaText(chunk);
          if (!deltaText) {
            continue;
          }
          process.stdout.write(deltaText);
          fullResponse += deltaText;
          if (!hasVisibleStreamOutput && deltaText.trim().length > 0) {
            hasVisibleStreamOutput = true;
          }
        }
      } finally {
        if (typeof iterator.return === 'function') {
          await iterator.return();
        }
      }
    };

    const availableTools = getAgentTools(agent);
    const toolDefinitions = Object.values(availableTools).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: buildModelToolParameters(tool.parameters),
    }));

    const toolRequired = shouldRequireToolCall(userMessage.content);
    const messagesWithToolPolicy = toolDefinitions.length > 0
      ? [
        {
          role: 'system' as const,
          content:
            `Tool-calling is available for this turn. You may call only these tools: ${toolDefinitions.map(tool => tool.name).join(', ')}. `
            + 'Do not invent tool names. If a listed tool can retrieve required information, call it instead of asking the developer to run shell commands.'
            + ' If ask_human or ask_question is available, use it for required developer input (questionType can be input, confirm, select, checklist, or password).'
            + (toolRequired
              ? ' For this request, you must call at least one listed tool before giving your final answer.'
              : ''),
        },
        ...messages,
      ]
      : messages;

    if (toolDefinitions.length === 0) {
      await streamPlainResponse(messages);
    } else {
      try {
        let toolStreamed = false;
        const result = await withAbortSignal(
          llm.chatWithTools(
            agent,
            messagesWithToolPolicy,
            toolDefinitions,
            async (toolCall) => {
            const toolLabel = `${toolCall.toolName}(${formatToolArgs(toolCall.args)})`;
            emitRuntimeEvent(hooks, {
              kind: 'tool',
              toolName: toolCall.toolName,
              toolPhase: 'request',
              message: toolLabel,
            });

            if (isInteractiveQuestionTool(toolCall.toolName)) {
              emitRuntimeEvent(hooks, {
                kind: 'tool',
                toolName: toolCall.toolName,
                toolPhase: 'start',
                message: 'Asking developer question',
              });

              const execution = await executeInteractiveQuestionTool(toolCall.toolName, toolCall.args, hooks);
              const outputText = execution.ok
                ? stringifyToolPayload(execution.result)
                : execution.error || 'Unknown question tool error';
              await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText, sessionManager, sessionId);

              emitRuntimeEvent(hooks, {
                kind: 'tool',
                toolName: toolCall.toolName,
                toolPhase: execution.ok ? 'result' : 'error',
                message: execution.ok ? 'Developer question answered' : (execution.error || 'Question tool failed'),
              });

              return {
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: execution.ok ? execution.result : (execution.error || 'Question tool failed'),
                isError: !execution.ok,
              };
            }

            const approved = await requestConfirm(hooks, {
              message: `Allow ${agent.name} to run tool ${toolLabel}?`,
              default: false,
            });

            if (!approved) {
              emitRuntimeEvent(hooks, {
                kind: 'tool',
                toolName: toolCall.toolName,
                toolPhase: 'denied',
                message: 'Tool call denied by user',
              });
            } else {
              emitRuntimeEvent(hooks, {
                kind: 'tool',
                toolName: toolCall.toolName,
                toolPhase: 'start',
                message: 'Executing tool call',
              });
            }

            const execution = await executeAgentTool(
              {
                toolName: toolCall.toolName,
                params: toolCall.args,
                context: {
                  agent,
                  workspaceRoot: agentManager.workspaceRoot,
                  currentFiles: contextFiles,
                },
              },
              {
                onBeforeExecute: () => approved,
              },
            );

            const outputText = execution.ok
              ? stringifyToolPayload(execution.result)
              : execution.error || 'Unknown tool execution error';
            await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText, sessionManager, sessionId);

            emitRuntimeEvent(hooks, {
              kind: 'tool',
              toolName: toolCall.toolName,
              toolPhase: execution.ok ? 'result' : 'error',
              message: execution.ok ? 'Tool call completed' : (execution.error || 'Tool call failed'),
            });

            return {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: execution.ok ? execution.result : (execution.error || 'Tool execution failed'),
              isError: !execution.ok,
            };
            },
            llmOptions,
            skill,
            teamRoster,
            8,
            (delta) => {
              if (!delta) {
                return;
              }
              toolStreamed = true;
              process.stdout.write(delta);
              if (!hasVisibleStreamOutput && delta.trim().length > 0) {
                hasVisibleStreamOutput = true;
              }
            },
          ),
          hooks?.signal,
          'Chat tool-call aborted by user.',
        );

        fullResponse = result.text;
        streamedResponse = streamedResponse || toolStreamed;
      } catch (toolError) {
        if (!shouldFallbackToPlainChat(toolError)) {
          throw toolError;
        }

        writeInfo(hooks, '\nTool-calling is not supported by this endpoint/model; retrying without tools...');
        await streamPlainResponse(messagesWithToolPolicy);
      }
    }

    if (!streamedResponse || !hasVisibleStreamOutput) {
      process.stdout.write(fullResponse);
    }
    
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    writeError(hooks, `LLM unavailable: ${formatLlmError(error)}`);
    writeInfo(hooks, `Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}`);
    writeInfo(hooks, 'Try again when your LLM server is back online, or run ait test-connection for diagnostics.');
    return {};
  }

  process.stdout.write('\n\n');

  // Record interaction
  await agentManager.recordInteraction(agent.id);

  // Save agent response
  const agentMessage: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, agentMessage);
  }
  history.push(agentMessage);

  const hireFromResponse = extractHireDirective(fullResponse, agent);
  if (hireFromResponse) {
    const lineage = handoffTracker?.get(agent.id);
    const managerAgent = lineage?.fromAgentId ? agentManager.getAgent(lineage.fromAgentId) : undefined;
    const created = await createAgentFromChat(
      agentManager,
      agent,
      hireFromResponse.name,
      hireFromResponse.role,
      managerAgent,
    );
    if (created) {
      writeInfo(hooks, `${agent.name} hired ${created.name} as ${created.role}. (${created.id})`);
      await agentManager.loadAllAgents();
      const onboardingManager = managerAgent ?? agent;
      await seedNewHireContext(
        chatManager,
        created,
        onboardingManager,
        lineage?.note,
        sessionManager,
        sessionId,
      );
    }
  }

  const handoff = detectResponseHandoffDirective(fullResponse, agentManager, agent.id);
  if (handoff?.target) {
    writeInfo(hooks, `\n${agent.name} (${agent.role}) handed off to ${handoff.target.name} (${handoff.target.role}).`);
    const trimmedResponse = fullResponse.trim();
    const trimmedNote = handoff.message?.trim();
    const combinedNote = trimmedNote
      ? `${trimmedNote}\n\n---\nContext from ${agent.name}:\n${trimmedResponse}`
      : trimmedResponse;

    return {
      switchedTo: handoff.target,
      handoffMessage: combinedNote,
    };
  }

  const claimedHandoffName = extractClaimedHandoffName(fullResponse);
  if (claimedHandoffName) {
    writeWarn(hooks, `${agent.name} mentioned "${claimedHandoffName}", but no matching team member exists yet. Try chat ${claimedHandoffName} (fuzzy search), or run hire to create them first.`);
  }

  return {};
}

function resolveDeveloperName(env: Record<string, string>): string | undefined {
  return env['AI_TEAM_USER_NAME']?.trim()
    || env['AI_TEAM_USER']?.trim()
    || env['AI_TEAM_DEVELOPER']?.trim();
}

async function printEmployeesList(workspaceRoot: string, request: { role?: string; feature?: string }) {
  const employees = await listEmployeesCommand(workspaceRoot, request);
  if (employees.length === 0) {
    process.stdout.write('No employees found.\n');
    return;
  }

  process.stdout.write('\nEmployees\n\n');
  for (const employee of employees) {
    process.stdout.write(`${employee.name} (${employee.role}) [${employee.id}]\n`);
  }
}

async function printEmployeeInfo(workspaceRoot: string, query: string) {
  const matches = await resolveEmployeesCommand(workspaceRoot, query);
  if (matches.length === 0) {
    process.stdout.write(`No employee found matching "${query}".\n`);
    return;
  }

  if (matches.length > 1) {
    process.stdout.write(`Multiple employees match "${query}":\n`);
    for (const match of matches) {
      process.stdout.write(`  - ${match.name} (${match.role}) [${match.id}]\n`);
    }
    return;
  }

  const employee = matches[0];
  process.stdout.write(`\n${employee.name} (${employee.role})\n`);
  process.stdout.write(`ID: ${employee.id}\n`);
  process.stdout.write(`Context: ${employee.contextLevel}\n`);
  if (employee.reportsTo) {
    process.stdout.write(`Reports to: ${employee.reportsTo}\n`);
  }
}

// ============================================================================
// Agent greeting
// ============================================================================

/**
 * Have the agent introduce themselves and greet the user.
 * Only called on first contact (no history) or on agent switch.
 */
async function greetUser(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: import('@ai-team/core').Skill | undefined,
  developerName: string | undefined,
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
) {
  const nameRef = developerName ? `, ${developerName}` : '';
  const prompt = `The developer${nameRef} just opened a chat with you. `
    + 'Introduce yourself briefly: say hi, state your name and role, and ask what you can do for them. '
    + '1-2 sentences max. Be warm but concise.';

  // We inject this as a hidden system-level nudge, not a user message
  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: prompt },
  ];

  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(`\n${agent.name} (${agent.role}): `);

  let fullResponse = '';
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill);
    const stream = await llm.streamChat(agent, messages, llmOptions, skill, teamRoster);
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        const nextChunk = await withAbortSignal(
          iterator.next(),
          hooks?.signal,
          'Chat greeting aborted by user.',
        );
        if (nextChunk.done) {
          break;
        }
        const deltaText = extractStreamDeltaText(nextChunk.value);
        if (deltaText) {
          process.stdout.write(deltaText);
          fullResponse += deltaText;
        }
      }
    } finally {
      if (typeof iterator.return === 'function') {
        await iterator.return();
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    writeError(hooks, `LLM unavailable: ${formatLlmError(err)}`);
    writeInfo(hooks, `Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}`);
    writeInfo(hooks, 'LLM greeting skipped. You can continue once the server is reachable.');
    return;
  }

  process.stdout.write('\n\n');

  // Save the greeting to history so it persists
  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, agentMsg);
  }
  history.push(agentMsg);
  await agentManager.recordInteraction(agent.id);
}

// ============================================================================
// Forward / switch detection
// ============================================================================

const FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+(.+)/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+(.+)/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+(.+)/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+(.+)/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+(.+)/i,
];

const HANDOFF_PATTERNS = [
  /(?:you(?:'| a)?re now talking to|you are now talking to|you(?:'| a)?re talking to|you are talking to)\s+\**([^\n.,:;!]+)\**/i,
  /(?:this is)\s+\**([^\n.,:;!]+)\**/i,
];

/**
 * Detect if the user's message is asking to be forwarded to another agent.
 * Returns the resolved Agent if a match is found, or undefined otherwise.
 */
function detectForwardRequest(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Agent | undefined {
  const target = extractForwardTargetName(message);
  if (!target) return undefined;

  const matches = agentManager.resolveAgent(target);
  const filtered = matches.filter(a => a.id !== currentAgentId);
  if (filtered.length > 0) return filtered[0];

  return undefined;
}

function parseChatSwitchArgs(args: string): { targetQuery: string; handoffMessage?: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return { targetQuery: '' };
  }

  // Supports: chat "linda tran" message..., chat linda message..., chat hr-director
  const quotedMatch = trimmed.match(/^"([^"]+)"\s*(.*)$/);
  if (quotedMatch) {
    const targetQuery = quotedMatch[1].trim();
    const handoffMessage = quotedMatch[2].trim();
    return {
      targetQuery,
      handoffMessage: handoffMessage.length > 0 ? handoffMessage : undefined,
    };
  }

  const [targetQuery, ...rest] = trimmed.split(/\s+/);
  const handoffMessage = rest.join(' ').trim();
  return {
    targetQuery,
    handoffMessage: handoffMessage.length > 0 ? handoffMessage : undefined,
  };
}

function extractForwardTargetName(message: string): string | undefined {
  for (const pattern of FORWARD_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    let target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (!target) continue;

    // Strip trailing conjunctions or polite add-ons ("and introduce me", "please", etc.)
    target = target.replace(/\b(?:and|but|so|then|because|while|plus)\b.*$/i, '').trim();
    target = target.replace(/\b(?:please|thanks|thank you)\b.*$/i, '').trim();

    if (target) return target;
  }

  return undefined;
}

function detectResponseHandoff(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): Agent | undefined {
  const directForward = detectForwardRequest(message, agentManager, currentAgentId);
  if (directForward) return directForward;

  for (const pattern of HANDOFF_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    const target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (!target) continue;

    const matches = agentManager.resolveAgent(target);
    const filtered = matches.filter(a => a.id !== currentAgentId);
    if (filtered.length > 0) return filtered[0];
  }

  return undefined;
}

function detectResponseHandoffDirective(
  message: string,
  agentManager: AgentManager,
  currentAgentId: string,
): { target?: Agent; message?: string } | undefined {
  const explicit = message.match(/^\s*HANDOFF:\s*([^|\n]+?)(?:\s*\|\s*([^\n]+))?\s*$/im);
  if (explicit) {
    const targetQuery = explicit[1].trim();
    const note = explicit[2]?.trim();
    if (targetQuery) {
      const matches = agentManager.resolveAgent(targetQuery);
      const filtered = matches.filter(a => a.id !== currentAgentId);
      if (filtered.length > 0) {
        return { target: filtered[0], message: note };
      }
    }
  }

  const fallback = detectResponseHandoff(message, agentManager, currentAgentId);
  if (fallback) {
    return { target: fallback };
  }

  return undefined;
}

function extractClaimedHandoffName(message: string): string | undefined {
  for (const pattern of HANDOFF_PATTERNS) {
    const match = message.match(pattern);
    if (!match) continue;

    const target = match[1]
      .replace(/[?.!,]+$/, '')
      .replace(/^the\s+/i, '')
      .trim();

    if (target) return target;
  }

  return undefined;
}

function extractHireDirective(
  message: string,
  currentAgent: Agent,
): { name: string; role: string } | undefined {
  if (currentAgent.role !== 'hr-director') {
    return undefined;
  }

  const explicit = message.match(/^\s*HIRE:\s*([^|\n]+?)\s*\|\s*([a-z0-9][a-z0-9\- ]+)\s*$/im);
  if (explicit) {
    const name = explicit[1].trim();
    const role = explicit[2].trim().toLowerCase().replace(/\s+/g, '-');
    if (name && role) {
      return { name, role };
    }
  }

  // Natural-language fallback: match "hire <FirstName LastName> as <role>".
  // Name must look like a proper person name (2–3 capitalized words, each
  // 2-20 chars) to avoid capturing arbitrary phrases like "priorities and
  // start scoping candidates" as a hire name.
  const natural = message.match(
    /(?:hire|hiring|onboard|onboarding|bringing on)\s+((?:[A-Z][a-z]{1,19})(?:\s+[A-Z][a-z]{1,19}){1,2})\s+(?:as|for)\s+(?:a|an|the|our)?\s*([a-z][a-z0-9 -]{2,40})/i,
  );
  if (!natural) {
    return undefined;
  }

  const name = natural[1].trim();
  const role = natural[2].trim().toLowerCase().replace(/\s+/g, '-');
  if (!name || !role) {
    return undefined;
  }

  return { name, role };
}

async function createAgentFromChat(
  agentManager: AgentManager,
  hiringAgent: Agent,
  name: string,
  role: string,
  managerAgent?: Agent,
): Promise<Agent | undefined> {
  const id = name.toLowerCase().replace(/\s+/g, '-');
  const existingById = agentManager.getAgent(id);
  if (existingById) {
    return existingById;
  }

  const existingByRole = agentManager.getAllAgents().find(a => a.role.toLowerCase() === role.toLowerCase());
  if (existingByRole) {
    return existingByRole;
  }

  const lowerRole = role.toLowerCase();
  const personality = /architect|cto/.test(lowerRole)
    ? { communication_style: 'strategic' as const, expertise_level: 'senior' as const, mentoring: true }
    : /qa|test|security|data|analyst/.test(lowerRole)
      ? { communication_style: 'analytical' as const, expertise_level: 'mid-level' as const, mentoring: true }
      : /hr|people|recruit|headhunt/.test(lowerRole)
        ? { communication_style: 'supportive' as const, expertise_level: 'senior' as const, mentoring: true }
        : { communication_style: 'collaborative' as const, expertise_level: 'mid-level' as const, mentoring: true };

  // Determine the correct manager in the org hierarchy.
  // If an explicit managerAgent was provided (e.g. via handoff lineage), use it.
  // Otherwise, for senior/leadership roles (architect, lead, etc.) find the CTO
  // or top executive rather than defaulting to the hiring HR agent.
  let reportsTo: string;
  if (managerAgent) {
    reportsTo = managerAgent.id;
  } else {
    const allAgents = agentManager.getAllAgents();
    const cto = allAgents.find(a => a.role === 'cto');
    const topExec = cto ?? allAgents.find(a => a.type === 'executive' && a.id !== hiringAgent.id);
    const isLeadershipRole = /architect|lead|director|manager|principal/.test(lowerRole);
    reportsTo = (isLeadershipRole && topExec) ? topExec.id : (topExec?.id ?? hiringAgent.id);
  }

  // Infer type and contextLevel from role
  const isLeadership = /architect|lead|director|principal/.test(lowerRole);
  const agentType = isLeadership ? RoleType.LEADERSHIP : RoleType.INDIVIDUAL_CONTRIBUTOR;
  const contextLevel = isLeadership ? ContextLevel.REPOSITORY : ContextLevel.MODULE;

  try {
    const created = await agentManager.createAgent({
      name,
      role,
      type: agentType,
      contextLevel,
      reportsTo,
      personality,
      avatar: {
        type: 'ai-generated',
        style: 'professional-headshot',
        seed: `${id}-${role}`,
      },
    });

    return created;
  } catch {
    return undefined;
  }
}

// ============================================================================
// In-chat command parsing
// ============================================================================

const KNOWN_COMMANDS: string[] = IN_CHAT_COMMAND_REGISTRY.map(entry => entry.key);

interface InChatCommand {
  name: string;
  args?: string;
}

interface DirectToolCall {
  toolName: string;
  params: Record<string, unknown>;
}

function printGraphHierarchy(
  graphData: { nodes: { id: string; data: Record<string, unknown> }[]; edges: { source: string; target: string; type: string }[] },
  hooks: ChatRuntimeHooks | undefined,
): void {
  const { nodes, edges } = graphData;

  // Find root nodes (not managed by anyone)
  const hasManager = new Set(
    edges.filter(e => e.type === 'reports-to').map(e => e.source),
  );
  const roots = nodes.filter(n => !hasManager.has(n.id));

  const printed = new Set<string>();

  function printNode(nodeId: string, indent: number) {
    if (printed.has(nodeId)) return;
    printed.add(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const prefix = '  '.repeat(indent);
    const label = node.data.label ?? node.id;
    const role = node.data.role ?? '';
    writeInfo(hooks, `${prefix}- ${label} (${role})`);

    // Direct reports: edges where target === this node
    const reports = edges
      .filter(e => e.type === 'reports-to' && e.target === nodeId)
      .map(e => e.source);

    for (const reportId of reports) {
      printNode(reportId, indent + 1);
    }
  }

  if (roots.length === 0 && nodes.length > 0) {
    // Fallback: just list all nodes
    for (const n of nodes) {
      const label = n.data.label ?? n.id;
      const role = n.data.role ?? '';
      writeInfo(hooks, `  - ${label} (${role})`);
    }
  } else {
    for (const root of roots) {
      printNode(root.id, 0);
    }
  }
}

function selectDefaultTopAgent(agents: Agent[]): Agent | undefined {
  if (agents.length === 0) {
    return undefined;
  }

  const ids = new Set(agents.map(agent => agent.id));
  const roots = agents.filter(agent => !agent.reportsTo || !ids.has(agent.reportsTo));
  const candidates = roots.length > 0 ? roots : agents;

  const rankType = (agent: Agent): number => {
    switch (agent.type) {
      case RoleType.EXECUTIVE:
        return 0;
      case RoleType.LEADERSHIP:
        return 1;
      case RoleType.TEAM_LEAD:
        return 2;
      case RoleType.INDIVIDUAL_CONTRIBUTOR:
        return 3;
      default:
        return 4;
    }
  };

  const rolePriority = (role: string): number => {
    const normalized = role.toLowerCase();
    if (normalized === 'cto' || normalized.includes('chief-architect') || normalized.includes('chief architect')) {
      return 0;
    }
    if (normalized.includes('head') || normalized.includes('director')) {
      return 1;
    }
    return 2;
  };

  return [...candidates].sort((a, b) => {
    const typeDelta = rankType(a) - rankType(b);
    if (typeDelta !== 0) {
      return typeDelta;
    }

    const roleDelta = rolePriority(a.role) - rolePriority(b.role);
    if (roleDelta !== 0) {
      return roleDelta;
    }

    const createdA = Date.parse(a.createdAt || '');
    const createdB = Date.parse(b.createdAt || '');
    if (!Number.isNaN(createdA) && !Number.isNaN(createdB) && createdA !== createdB) {
      return createdA - createdB;
    }

    return a.id.localeCompare(b.id);
  })[0];
}

function isArchitectLikeRole(role: string): boolean {
  return /architect|cto/i.test(role);
}

async function getWorkspaceOverview(workspaceRoot: string): Promise<string> {
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.pnpm-store']);
  const lines: string[] = [];
  const maxDepth = 2;
  const maxEntries = 120;
  let emitted = 0;

  async function walk(currentPath: string, relativePath: string, depth: number): Promise<void> {
    if (depth > maxDepth || emitted >= maxEntries) return;

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (emitted >= maxEntries) break;
      if (entry.name.startsWith('.') && entry.name !== '.ai-team') continue;

      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const childAbs = `${currentPath}/${entry.name}`;

      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        lines.push(`${'  '.repeat(depth)}- ${childRel}/`);
        emitted++;
        await walk(childAbs, childRel, depth + 1);
      } else {
        lines.push(`${'  '.repeat(depth)}- ${childRel}`);
        emitted++;
      }
    }
  }

  await walk(workspaceRoot, '', 0);

  const rootImportant = ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'README.md', 'ARCHITECTURE.md'];
  const foundImportant: string[] = [];
  for (const filename of rootImportant) {
    try {
      await fs.stat(`${workspaceRoot}/${filename}`);
      foundImportant.push(filename);
    } catch {
      // ignore missing file
    }
  }

  return [
    'Workspace snapshot (truncated):',
    foundImportant.length > 0 ? `Root key files: ${foundImportant.join(', ')}` : 'Root key files: none detected',
    ...lines,
    emitted >= maxEntries ? '(truncated)' : '',
  ].filter(Boolean).join('\n');
}

/**
 * Parse a user message as an in-chat command.
 * Returns the parsed command or undefined if it's a normal message.
 *
 * Recognised formats:
 *   "/chat hr"        → { name: 'chat', args: 'hr' }
 *   "/list"           → { name: 'list' }
 *   "/hire"           → { name: 'hire' }
 *   "/help"           → { name: 'help' }
 *   "/graph"          → { name: 'graph' }
 */
function parseInChatCommand(message: string): InChatCommand | undefined {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  const withoutPrefix = trimmed.slice(1).trim();
  if (!withoutPrefix) {
    return undefined;
  }

  const [first, ...rest] = withoutPrefix.split(/\s+/);
  const cmd = (first || '').toLowerCase();
  const canonicalCmd = IN_CHAT_COMMAND_ALIASES[cmd] || cmd;

  if (KNOWN_COMMANDS.includes(canonicalCmd)) {
    return {
      name: canonicalCmd,
      args: rest.length > 0 ? rest.join(' ') : undefined,
    };
  }

  return undefined;
}

function parseDirectToolCall(message: string): DirectToolCall | undefined {
  const trimmed = message.trim();

  let payload: string | undefined;
  if (trimmed.startsWith('#')) {
    payload = trimmed.slice(1).trim();
  } else if (/^\/tool\b/i.test(trimmed)) {
    payload = trimmed.replace(/^\/tool\b/i, '').trim();
  }

  if (!payload) {
    return undefined;
  }

  const match = payload.match(/^([a-zA-Z0-9_-]+)(?:\s+([\s\S]+))?$/);
  if (!match) {
    return undefined;
  }

  const toolName = match[1];
  const rawParams = match[2]?.trim();

  if (!ALL_TOOLS[toolName]) {
    process.stdout.write(`Unknown tool '${toolName}'.\n`);
    return undefined;
  }

  if (!rawParams) {
    return { toolName, params: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch {
    process.stdout.write('Direct tool params must be valid JSON object syntax.\n');
    process.stdout.write('Example: #run_cli_tool {"command":"git","args":["status","--short"]}\n');
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stdout.write('Direct tool params must be a JSON object.\n');
    return undefined;
  }

  return {
    toolName,
    params: parsed as Record<string, unknown>,
  };
}

function isDirectToolSyntax(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.startsWith('#') || /^\/tool\b/i.test(trimmed);
}

async function executeDirectToolCall(
  directToolCall: DirectToolCall,
  chatManager: ChatManager,
  history: ChatMessage[],
  agent: Agent,
  workspaceRoot: string,
  contextFiles?: string[],
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
) {
  const { toolName, params } = directToolCall;
  const allowedTools = getAgentTools(agent);
  const toolLabel = `${toolName}(${formatToolArgs(params)})`;
  const isAllowedForAgent = Boolean(allowedTools[toolName]);

  if (isAllowedForAgent) {
    if (isInteractiveQuestionTool(toolName)) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName,
        toolPhase: 'start',
        message: 'Asking developer question',
      });

      const execution = await executeInteractiveQuestionTool(toolName, params, hooks);
      if (!execution.ok) {
        emitRuntimeEvent(hooks, {
          kind: 'tool',
          toolName,
          toolPhase: 'error',
          message: execution.error || 'Unknown error',
        });
        writeError(hooks, `Direct tool call failed: ${execution.error || 'Unknown error'}`);
        return;
      }

      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName,
        toolPhase: 'result',
        message: 'Developer question answered',
      });

      const outputText = stringifyToolPayload(execution.result);
      writeInfo(hooks, '\nDirect Tool Output\n');
      writeInfo(hooks, outputText);
      writeInfo(hooks, '');

      await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText, sessionManager, sessionId);
      writeInfo(hooks, `  (Shared direct tool output with ${agent.name} for future context.)`);
      return;
    }

    const approved = await requestConfirm(hooks, {
      message: `Allow ${agent.name} to run direct tool ${toolLabel}?`,
      default: false,
    });

    if (!approved) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName,
        toolPhase: 'denied',
        message: 'Direct tool call canceled by user',
      });
      writeInfo(hooks, 'Direct tool call canceled by user.');
      return;
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName,
      toolPhase: 'start',
      message: 'Executing direct tool call',
    });

    const execution = await executeAgentTool(
      {
        toolName,
        params,
        context: {
          agent,
          workspaceRoot,
          currentFiles: contextFiles,
        },
      },
      {
        onBeforeExecute: () => true,
      },
    );

    if (!execution.ok) {
      emitRuntimeEvent(hooks, {
        kind: 'tool',
        toolName,
        toolPhase: 'error',
        message: execution.error || 'Unknown error',
      });
      writeError(hooks, `Direct tool call failed: ${execution.error || 'Unknown error'}`);
      return;
    }

    emitRuntimeEvent(hooks, {
      kind: 'tool',
      toolName,
      toolPhase: 'result',
      message: 'Direct tool call completed',
    });

    const outputText = stringifyToolPayload(execution.result);
    writeInfo(hooks, '\nDirect Tool Output\n');
    writeInfo(hooks, outputText);
    writeInfo(hooks, '');

    await appendToolOutputToHistory(chatManager, history, agent.id, execution.toolName, outputText, sessionManager, sessionId);
    writeInfo(hooks, `  (Shared direct tool output with ${agent.name} for future context.)`);
    return;
  }

  const approvedOverride = await requestConfirm(hooks, {
    message:
      `Tool '${toolName}' is not allowed for ${agent.name}. Run as private developer override `
      + '(output will not be shared with agent context)?',
    default: false,
  });

  if (!approvedOverride) {
    writeInfo(hooks, 'Private override canceled by user.');
    return;
  }

  const overrideAgent: Agent = {
    ...agent,
    tools: [...new Set([...(agent.tools || []), toolName])],
  };

  const execution = await executeAgentTool(
    {
      toolName,
      params,
      context: {
        agent: overrideAgent,
        workspaceRoot,
        currentFiles: contextFiles,
      },
    },
    {
      onBeforeExecute: () => true,
    },
  );

  if (!execution.ok) {
    writeError(hooks, `Private tool call failed: ${execution.error || 'Unknown error'}`);
    writeInfo(hooks, 'Tool output was not written to chat history.');
    return;
  }

  const outputText = stringifyToolPayload(execution.result);
  writeInfo(hooks, '\nPrivate Tool Output\n');
  writeInfo(hooks, outputText);
  writeInfo(hooks, '');
  writeInfo(hooks, 'Tool output was intentionally kept out of agent context.');
}

/**
 * Resolve an agent switch from a "chat <query>" command.
 * If multiple agents match, shows a selection prompt.
 * Returns undefined if no match or user cancels.
 */
async function resolveSwitch(
  query: string,
  agentManager: AgentManager,
  currentAgentId: string,
  hooks?: ChatRuntimeHooks,
): Promise<Agent | undefined> {
  const matches = agentManager.resolveAgent(query);
  if (matches.length === 0) return undefined;

  // Prefer matches that aren't the current agent
  const filtered = matches.filter(a => a.id !== currentAgentId);
  const candidates = filtered.length > 0 ? filtered : matches;

  if (candidates.length === 1) return candidates[0];

  // Multiple matches — let the user pick
  const chosen = await requestSelect(hooks, {
    message: `Multiple agents match "${query}". Which one?`,
    choices: candidates.map(a => ({
      name: `${a.name} — ${a.role} [${a.id}]`,
      value: a.id,
    })),
  });
  return agentManager.getAgent(chosen);
}

/**
 * Print available in-chat commands.
 */
function printChatHelp() {
  process.stdout.write('\n  In-chat commands:\n\n');
  process.stdout.write('  CLI (outside chat): ait chat <name|role>\n');
  process.stdout.write('  In chat:            /chat <name|role> [handoff note]\n');
  process.stdout.write('  Example:            /chat linda Please review the API contract draft\n');
  const longestUsage = IN_CHAT_COMMAND_REGISTRY.reduce((max, entry) => Math.max(max, entry.usage.length), 0);
  for (const entry of IN_CHAT_COMMAND_REGISTRY) {
    const paddedUsage = entry.usage.padEnd(longestUsage + 2, ' ');
    process.stdout.write(`  ${paddedUsage}${entry.description}\n`);
  }
  process.stdout.write('  /tool <tool> <json> Alias for direct tool call\n');
  process.stdout.write('  exit              End the conversation\n');
  process.stdout.write('\n  Or just ask to be "forwarded to" someone.\n\n');
}

function formatUserPrompt(agent: Agent): string {
  return `You → ${agent.name} (${agent.role}):`;
}

function printCurrentChatTarget(agent: Agent) {
  process.stdout.write('\nCurrent chat target\n\n');
  process.stdout.write(`  Name: ${agent.name}\n`);
  process.stdout.write(`  Role: ${agent.role}\n`);
  process.stdout.write(`  ID:   ${agent.id}\n`);
}

/**
 * Print recent chat history with the current agent.
 * Defaults to last 10 messages; pass a number to see more.
 */
function printHistory(history: ChatMessage[], agent: Agent, countArg?: string) {
  const count = countArg ? parseInt(countArg, 10) || 10 : 10;
  const recent = history.slice(-count);

  if (recent.length === 0) {
    process.stdout.write('\n  No messages yet.\n\n');
    return;
  }

  process.stdout.write(`\n  Last ${recent.length} message(s) with ${agent.name}:\n\n`);
  for (const msg of recent) {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    if (msg.from === 'human') {
      process.stdout.write(`  [${time}] You: ${msg.content}\n`);
    } else {
      process.stdout.write(`  [${time}] ${agent.name}: ${msg.content}\n`);
    }
  }
  process.stdout.write('\n');
}

/**
 * Print the agent's portfolio — their .md file contents (frontmatter + bio).
 */
async function printPortfolio(agent: Agent) {
  process.stdout.write(`\n  Portfolio: ${agent.name} (${agent.role})\n\n`);

  // Core fields
  process.stdout.write(`  ID:           ${agent.id}\n`);
  process.stdout.write(`  Role:         ${agent.role}\n`);
  process.stdout.write(`  Type:         ${agent.type || 'n/a'}\n`);
  process.stdout.write(`  Context:      ${agent.contextLevel || 'n/a'}\n`);
  if (agent.reportsTo) {
    process.stdout.write(`  Reports to:   ${agent.reportsTo}\n`);
  }
  if (agent.specializations && agent.specializations.length > 0) {
    process.stdout.write(`  Specializations: ${agent.specializations.join(', ')}\n`);
  }
  if (agent.personality) {
    const p = agent.personality;
    if (p.communication_style) process.stdout.write(`  Style:        ${p.communication_style}\n`);
    if (p.expertise_level) process.stdout.write(`  Expertise:    ${p.expertise_level}\n`);
  }
  if (agent.createdAt) {
    process.stdout.write(`  Created:      ${new Date(agent.createdAt).toLocaleDateString()}\n`);
  }
  if (agent.lastInteraction) {
    process.stdout.write(`  Last active:  ${new Date(agent.lastInteraction).toLocaleDateString()}\n`);
  }
  if (agent.conversationCount) {
    process.stdout.write(`  Messages:     ${agent.conversationCount}\n`);
  }

  // Bio / markdown body
  if (agent.markdown?.trim()) {
    process.stdout.write('\n  --- Bio ---\n');
    for (const line of agent.markdown.trim().split('\n')) {
      process.stdout.write(`  ${line}\n`);
    }
  }

  // Raw file
  process.stdout.write(`\n  File: ${agent.filePath}\n`);
  process.stdout.write('\n');
}

async function appendToolOutputToHistory(
  chatManager: ChatManager,
  history: ChatMessage[],
  agentId: string,
  toolName: string,
  output: string, sessionManager?: SessionManager, sessionId?: string) {
  const MAX_CONTEXT_CHARS = 4000;
  let content = output.trim();
  if (content.length > MAX_CONTEXT_CHARS) {
    content = content.slice(0, MAX_CONTEXT_CHARS) + '\n...(truncated)...';
  }

  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'system',
    content: `Tool Output (${toolName}):\n${content}`,
  };

  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, message);
  }
  history.push(message);
}

async function appendHandoffNote(
  chatManager: ChatManager,
  history: ChatMessage[],
  agentId: string,
  fromAgent: Agent,
  note: string, sessionManager?: SessionManager, sessionId?: string) {
  const trimmed = note.trim();
  const content = `Handoff note from ${fromAgent.name} (${fromAgent.role}):\n${trimmed}`;
  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: fromAgent.id,
    to: agentId,
    content,
  };
  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, message);
  }
  history.push(message);
}

async function acknowledgeHandoff(
  llm: LlmService,
  chatManager: ChatManager,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: import('@ai-team/core').Skill | undefined,
  fromAgent: Agent,
  note: string,
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
) {
  const trimmedNote = note?.trim();
  if (!trimmedNote) {
    return;
  }

  const truncated = truncateForPrompt(trimmedNote, 1600);
  const instructions =
    `You just received a handoff from ${fromAgent.name} (${fromAgent.role}). `
    + 'Acknowledge that context before taking action, restate the requested outcome in your own words, '
    + 'and ask the developer to confirm or add constraints before you proceed. '
    + 'Offer to sync with the originating teammate if anything is unclear. Here is the note you received:\n\n'
    + truncated;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'user', content: instructions },
  ];

  const teamRoster = agentManager.getAllAgents();
  process.stdout.write(`\n${agent.name} (${agent.role}): `);

  let fullResponse = '';
  let llmOptions: LlmChatOptions | undefined;
  try {
    llmOptions = await configureLlmForAgent(agentManager.workspaceRoot, llm, agent, skill);
    const stream = await llm.streamChat(agent, messages, llmOptions, skill, teamRoster);
    for await (const chunk of stream) {
      const deltaText = extractStreamDeltaText(chunk);
      if (deltaText) {
        process.stdout.write(deltaText);
        fullResponse += deltaText;
      }
    }
  } catch (error) {
    writeError(undefined, `LLM unavailable during handoff acknowledgement: ${formatLlmError(error)}`);
    process.stdout.write(`Attempted provider/model: ${formatLlmAttempt(llm, llmOptions)}\n`);
    return;
  }

  process.stdout.write('\n\n');

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
  };
  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, agentMsg);
  }
  history.push(agentMsg);
  await agentManager.recordInteraction(agent.id);
}

async function seedNewHireContext(
  chatManager: ChatManager,
  newAgent: Agent,
  manager: Agent,
  contextNote?: string, sessionManager?: SessionManager, sessionId?: string) {
  const trimmedNote = contextNote?.trim();
  const truncated = trimmedNote ? truncateForPrompt(trimmedNote, 1800) : undefined;
  const lines: string[] = [];
  lines.push(`Onboarding brief from ${manager.name} (${manager.role}).`);
  if (truncated) {
    lines.push('Context from the originating request:');
    lines.push(truncated);
  } else {
    lines.push('No detailed brief was attached. Sync with your manager immediately to capture requirements.');
  }
  lines.push('');
  lines.push(`You report directly to ${manager.name}. Confirm ownership of your files/modules before making changes.`);

  const message: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'system',
    content: lines.join('\n'),
  };

  if (sessionManager && sessionId) {
    await sessionManager.appendMessage(sessionId, message);
  }
  process.stdout.write(`  Shared onboarding brief with ${newAgent.name}.\n`);
}

async function configureLlmForAgent(
  _workspaceRoot: string,
  llm: LlmService,
  agent: Agent,
  skill?: import('@ai-team/core').Skill,
): Promise<LlmChatOptions | undefined> {
  return llm.initializeForChat(agent, skill);
}

function truncateForPrompt(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n...(truncated)...`;
}

function formatLlmError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('timed out')) {
    return `${message} The model endpoint did not respond in time.`;
  }

  return message;
}

function formatLlmAttempt(llm: LlmService, options?: LlmChatOptions): string {
  try {
    const providerName = llm.providerName;
    const provider = llm.provider;
    const model = options?.model || llm.modelName;
    if (providerName) {
      return `${providerName} (${provider}) / ${model}`;
    }
    return `${provider} / ${model}`;
  } catch {
    return '(unresolved)';
  }
}

function shouldFallbackToPlainChat(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return normalized.includes('400 status code')
    || normalized.includes('tool')
    || normalized.includes('function')
    || normalized.includes('invalid_request_error')
    || normalized.includes('unsupported');
}

function shouldRequireToolCall(message: string): boolean {
  const normalized = message.toLowerCase();
  const patterns = [
    'search',
    'find',
    'lookup',
    'look up',
    'grep',
    'error',
    'errors',
    'diagnose',
    'debug',
    'read file',
    'inspect',
    'analyze',
    'git status',
    'status of git',
    'repo status',
  ];

  return patterns.some(pattern => normalized.includes(pattern));
}

function parseCliGrantRequest(message: string): { employee: string; command: string } | undefined {
  const normalized = message.trim();
  const patterns = [
    /(?:hey\s+\w+[\s,]*)?allow\s+(.+?)\s+to\s+use\s+([a-zA-Z0-9_.-]+)/i,
    /grant\s+(.+?)\s+(?:access\s+to\s+|for\s+)?([a-zA-Z0-9_.-]+)\s*(?:command|tool)?/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const employee = match[1]?.trim();
    const command = match[2]?.trim().toLowerCase();
    if (employee && command) {
      return { employee, command };
    }
  }

  return undefined;
}

function parseEmployeeLlmUpdateRequest(message: string): {
  employee: string;
  provider?: string;
  modelKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
} | undefined {
  const normalized = message.trim();
  const employeeMatch = normalized.match(/(?:set|change|update)\s+(.+?)\s+(?:model|model\s+key|provider|temperature|max\s*tokens|top\s*p|presence\s*penalty|frequency\s*penalty)/i);
  if (!employeeMatch) {
    return undefined;
  }

  const employee = employeeMatch[1]?.trim();
  if (!employee) {
    return undefined;
  }

  const modelKeyMatch = normalized.match(/model\s+key\s+(?:to\s+)?([a-zA-Z0-9._/-]+)/i);
  const modelMatch = normalized.match(/(?:^|\s)model\s+(?:to\s+)?([a-zA-Z0-9._/-]+)/i);
  const providerMatch = normalized.match(/provider\s+(?:to\s+)?([a-zA-Z0-9._-]+)/i);
  const tempMatch = normalized.match(/temperature\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const maxTokensMatch = normalized.match(/max\s*tokens\s+(?:to\s+)?(\d+)/i);
  const topPMatch = normalized.match(/top\s*p\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const presenceMatch = normalized.match(/presence\s*penalty\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);
  const frequencyMatch = normalized.match(/frequency\s*penalty\s+(?:to\s+)?(-?\d+(?:\.\d+)?)/i);

  const request = {
    employee,
    provider: providerMatch?.[1]?.trim(),
    modelKey: modelKeyMatch?.[1]?.trim(),
    model: modelMatch?.[1]?.trim(),
    temperature: tempMatch ? Number(tempMatch[1]) : undefined,
    maxTokens: maxTokensMatch ? Number(maxTokensMatch[1]) : undefined,
    topP: topPMatch ? Number(topPMatch[1]) : undefined,
    presencePenalty: presenceMatch ? Number(presenceMatch[1]) : undefined,
    frequencyPenalty: frequencyMatch ? Number(frequencyMatch[1]) : undefined,
  };

  const hasUpdate = request.provider !== undefined
    || request.modelKey !== undefined
    || request.model !== undefined
    || request.temperature !== undefined
    || request.maxTokens !== undefined
    || request.topP !== undefined
    || request.presencePenalty !== undefined
    || request.frequencyPenalty !== undefined;

  if (!hasUpdate) {
    return undefined;
  }

  return request;
}

function buildModelToolParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    };
  }

  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: true,
  };
}

function formatToolArgs(args: unknown): string {
  const text = stringifyToolPayload(args);
  if (text.length <= 120) {
    return text;
  }
  return `${text.slice(0, 120)}...`;
}

function stringifyToolPayload(payload: unknown): string {
  if (payload === undefined) {
    return 'undefined';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

async function runShellCommand(
  command: string,
  workspaceRoot: string,
  chatManager: ChatManager,
  history: ChatMessage[],
  agent: Agent,
  hooks?: ChatRuntimeHooks,
  sessionManager?: SessionManager,
  sessionId?: string,
) {
  const trimmed = command.trim();
  if (!trimmed) {
    writeWarn(hooks, 'No command provided.');
    return;
  }

  const proceed = await requestConfirm(hooks, {
    message: `Run shell command: ${trimmed}?`,
    default: false,
  });

  if (!proceed) {
    writeInfo(hooks, 'Command aborted.');
    return;
  }

  writeInfo(hooks, `\n$ ${trimmed}`);

  const formatOutput = (stdout?: string, stderr?: string) => {
    const parts: string[] = [];
    if (stdout && stdout.trim().length > 0) {
      parts.push(stdout.trim());
    }
    if (stderr && stderr.trim().length > 0) {
      parts.push('stderr:\n' + stderr.trim());
    }
    return parts.join('\n\n');
  };

  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    });
    const output = formatOutput(stdout, stderr);
    if (output.length > 0) {
      writeInfo(hooks, output);
    } else {
      writeInfo(hooks, '(no output)');
    }
    await appendToolOutputToHistory(chatManager, history, agent.id, `shell:${trimmed}`, output || '(no output)', sessionManager, sessionId);
    writeInfo(hooks, `  (Shared command output with ${agent.name}.)`);  
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = formatOutput(err.stdout, err.stderr) || err.message;
    writeError(hooks, 'Command failed:');
    writeError(hooks, output);
    await appendToolOutputToHistory(chatManager, history, agent.id, `shell:${trimmed}`, output, sessionManager, sessionId);
    writeInfo(hooks, `  (Shared failed command output with ${agent.name}.)`);  
  }
}
