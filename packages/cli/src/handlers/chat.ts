import type {
  ChatOptions,
  StreamEvent,
  CommandDescriptor,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionSelectRequest,
  QuestionChecklistRequest,
  QuestionPasswordRequest,
} from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';
import { createIdeAdapter } from '@ai-team/infrastructure';
import type { IQuestionService } from '@ai-team/core';
import { findWorkspaceRoot } from '@ai-team/service';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isFrontendFileLogEnabled, writeFrontendDebugLog } from './debug-log.js';
import { askWithSlashSuggestions } from '../utils/slash-prompt.js';
import { createQuestionResponders } from './question-responders.js';

function setupAbortController(writeStderrLine: (text: string) => void) {
  const controller = new AbortController();
  let abortRequested = false;
  let forceExitTimer: NodeJS.Timeout | undefined;

  const requestAbort = (signalName: 'SIGINT' | 'SIGTERM') => {
    if (abortRequested) {
      process.exit(130);
      return;
    }

    abortRequested = true;
    writeStderrLine(chalk.yellow(`Received ${signalName}, aborting...`));
    controller.abort(new Error(`Aborted by ${signalName}`));
    forceExitTimer = setTimeout(() => {
      writeStderrLine(chalk.yellow('Abort timed out, forcing exit.'));
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
      if (forceExitTimer) {
        clearTimeout(forceExitTimer);
        forceExitTimer = undefined;
      }
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
  };
}

function isAbortLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /aborted|abort/i.test(message);
}

/**
 * Tab-completion for the chat REPL.
 * When the line starts with `/`, suggests matching slash commands (key + trailing space).
 * Matches against key, aliases, and usage token.
 */
function makeSlashCompleter(commands: Pick<CommandDescriptor, 'key' | 'aliases' | 'usage'>[]) {
  return function slashCompleter(line: string): [string[], string] {
    if (!line.startsWith('/')) return [[], line];
    const fragment = line.slice(1).toLowerCase();
    const hits = commands
      .filter((cmd) => {
        const usageToken = (cmd.usage ?? '')
          .trim()
          .replace(/^\//, '')
          .split(/\s+/, 1)[0]
          ?.toLowerCase();
        const keys = [cmd.key, ...(cmd.aliases ?? []), usageToken]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());
        return keys.some((k) => k.startsWith(fragment));
      })
      .map((cmd) => `/${cmd.key} `);
    return [hits.length ? hits : [], line];
  };
}

async function askLine(
  commands: Pick<CommandDescriptor, 'key' | 'aliases' | 'usage'>[],
  message: string,
  signal?: AbortSignal
): Promise<string> {
  const rl = createInterface({ input, output, completer: makeSlashCompleter(commands) });
  try {
    return (await rl.question(`${message} `, { signal })).trim();
  } finally {
    rl.close();
  }
}

function createChatQuestionResponders(
  signal: AbortSignal,
  onAnswered?: () => void,
  onQuestionStart?: () => void,
  projectNameFn?: () => Promise<string | undefined>,
  chatCommands: CommandDescriptor[] = [],
  inquirerQuestionService: Pick<
    IQuestionService,
    'confirm' | 'select' | 'checklist' | 'password'
  > = createQuestionResponders()
): Pick<IQuestionService, 'input' | 'confirm' | 'select' | 'checklist' | 'password'> {
  const normalizeSelection = (
    raw: string,
    choices: Array<{ name: string; value: string }>
  ): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    const byValue = choices.find((choice) => choice.value.toLowerCase() === trimmed.toLowerCase());
    if (byValue) return byValue.value;

    const idx = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(idx) && idx >= 1 && idx <= choices.length) {
      return choices[idx - 1]?.value;
    }

    const byName = choices.find((choice) => choice.name.toLowerCase() === trimmed.toLowerCase());
    return byName?.value;
  };

  return {
    input: async (request: QuestionInputRequest) => {
      onQuestionStart?.();
      while (true) {
        const answer = await askWithSlashSuggestions(request.message, chatCommands, signal);
        const trimmed = answer.trim().toLowerCase();
        if (
          trimmed === 'exit' ||
          trimmed === '/exit' ||
          trimmed === 'quit' ||
          trimmed === '/quit' ||
          trimmed === 'q' ||
          trimmed === '/q'
        ) {
          const resolvedName = await projectNameFn?.();
          const team = resolvedName ? `the ${resolvedName} team` : 'the team';
          process.stdout.write(`See you next time — ${team} will be here when you need us 👋\n`);
          process.exit(0);
        }
        if (request.validate) {
          const result = request.validate(answer);
          if (result !== true) {
            process.stderr.write(`${result}\n`);
            continue;
          }
        }
        onAnswered?.();
        return answer;
      }
    },
    confirm: async (request: QuestionConfirmRequest) => {
      onQuestionStart?.();
      if (process.stdin.isTTY) {
        const answer = await inquirerQuestionService.confirm(request);
        onAnswered?.();
        return answer;
      }

      const defaultValue = request.default ?? false;
      const suffix = defaultValue ? '[Y/n]' : '[y/N]';

      while (true) {
        const raw = (await askLine([], `${request.message} ${suffix}`, signal)).toLowerCase();
        if (!raw) {
          onAnswered?.();
          return defaultValue;
        }
        if (raw === 'y' || raw === 'yes') {
          onAnswered?.();
          return true;
        }
        if (raw === 'n' || raw === 'no') {
          onAnswered?.();
          return false;
        }
        process.stderr.write('Please answer yes or no.\n');
      }
    },
    select: async (request: QuestionSelectRequest) => {
      onQuestionStart?.();
      if (process.stdin.isTTY) {
        const selected = await inquirerQuestionService.select(request);
        onAnswered?.();
        return selected;
      }

      const lines = request.choices.map((choice, idx) => {
        const desc = choice.description ? ` — ${choice.description}` : '';
        return `  ${idx + 1}) ${choice.name} [${choice.value}]${desc}`;
      });
      const defaultValue = request.default;
      while (true) {
        process.stderr.write(`${request.message}\n${lines.join('\n')}\n`);
        const suffix = defaultValue ? ` (default: ${defaultValue})` : '';
        const raw = await askLine([], `Select one (number or value)${suffix}:`, signal);
        if (!raw.trim() && defaultValue) {
          onAnswered?.();
          return defaultValue;
        }
        const normalized = normalizeSelection(raw, request.choices);
        if (normalized) {
          onAnswered?.();
          return normalized;
        }
        if (request.allowOther && raw.trim()) {
          onAnswered?.();
          return raw.trim();
        }
        process.stderr.write('Please choose a listed option (number/value).\n');
      }
    },
    checklist: async (request: QuestionChecklistRequest) => {
      onQuestionStart?.();
      if (process.stdin.isTTY) {
        const selected = await inquirerQuestionService.checklist(request);
        onAnswered?.();
        return selected;
      }

      const lines = request.choices.map((choice, idx) => {
        const desc = choice.description ? ` — ${choice.description}` : '';
        return `  ${idx + 1}) ${choice.name} [${choice.value}]${desc}`;
      });
      const defaults = request.default ?? [];
      const defaultSuffix = defaults.length > 0 ? ` (default: ${defaults.join(', ')})` : '';
      while (true) {
        process.stderr.write(`${request.message}\n${lines.join('\n')}\n`);
        const raw = await askLine(
          [],
          `Select one or more (comma-separated numbers/values)${defaultSuffix}:`,
          signal
        );
        const entries = raw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        const selected = entries.length === 0 ? defaults : entries;
        const resolved = selected
          .map((entry) => normalizeSelection(entry, request.choices))
          .filter((value): value is string => Boolean(value));
        if (resolved.length !== selected.length) {
          if (request.allowOther) {
            const passthrough = selected.map((entry, idx) => resolved[idx] ?? entry);
            onAnswered?.();
            return passthrough;
          }
          process.stderr.write('One or more selections are invalid. Use listed numbers/values.\n');
          continue;
        }
        if (request.minSelections && resolved.length < request.minSelections) {
          process.stderr.write(`Please select at least ${request.minSelections} option(s).\n`);
          continue;
        }
        if (request.maxSelections && resolved.length > request.maxSelections) {
          process.stderr.write(`Please select at most ${request.maxSelections} option(s).\n`);
          continue;
        }
        onAnswered?.();
        return resolved;
      }
    },
    password: async (request: QuestionPasswordRequest) => {
      onQuestionStart?.();
      if (process.stdin.isTTY) {
        const answer = await inquirerQuestionService.password(request);
        onAnswered?.();
        return answer;
      }
      const answer = await askLine([], request.message, signal);
      onAnswered?.();
      return answer;
    },
  };
}

export const CHAT_RENDERING_TESTING = {
  createChatQuestionResponders,
};

function handleOneShotEvent(
  event: StreamEvent<string>,
  writeStderrLine: (text: string) => void
): void {
  if (event.kind === 'status' && event.message) {
    writeStderrLine(chalk.dim(`[backend:mediator:${event.command}] ${event.message}`));
    return;
  }

  if (event.kind === 'question') {
    writeStderrLine(
      chalk.yellow(`[frontend:question:${event.questionType || 'input'}] ${event.message}`)
    );
    return;
  }

  if (event.kind === 'tool') {
    const phase = event.toolPhase || 'event';
    const formatted = formatToolEventMessage(event);
    const suffix = formatted ? ` — ${formatted}` : '';
    writeStderrLine(chalk.cyan(`[backend:tool:${phase}] ${event.toolName}${suffix}`));
    const detail = formatToolEventDetail(event);
    if (detail) writeStderrLine(detail);
    return;
  }

  if (event.kind === 'error') {
    throw new Error(event.message);
  }
}

interface AgentAccessLike {
  agentId: string;
  canRead: boolean;
  canWrite: boolean;
  canList: boolean;
}

interface FileTreeNodeLike {
  name?: string;
  isDirectory?: boolean;
  children?: FileTreeNodeLike[];
  agentAccess?: AgentAccessLike[];
}

interface FileTreePayloadLike {
  path?: string;
  tree?: FileTreeNodeLike;
}

interface WhoShouldPayloadLike {
  type?: string;
  task?: string;
  matches?: Array<{ agentId?: string; agentName?: string; agentRole?: string }>;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toPayloadRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    return parseJsonObject(value);
  }
  return null;
}

function resolveDeveloperDisplayName(env: NodeJS.ProcessEnv): string {
  const fromEnv =
    env.AI_TEAM_USER_NAME?.trim() || env.AI_TEAM_USER?.trim() || env.AI_TEAM_DEVELOPER?.trim();
  if (fromEnv) return fromEnv;
  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    if (gitName) return gitName;
  } catch {
    // git not available or not configured
  }
  return 'You';
}

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (str.codePointAt(i) ?? 0) + ((hash << 5) - hash);
  }
  return Math.abs(hash % 360);
}

function generateAgentColor(agent: { name: string; avatar?: { color?: string; seed?: string } }): string {
  if (agent.avatar?.color) return agent.avatar.color;
  const seed = agent.avatar?.seed || agent.name;
  const hue = hashStringToHue(seed);
  return `hsl(${hue}, 70%, 60%)`;
}

function parseHslHue(hsl: string): number | undefined {
  const m = /^hsl\((\d+)/i.exec(hsl);
  return m ? Number(m[1]) : undefined;
}

function countTreeNodes(node?: FileTreeNodeLike): { files: number; directories: number } {
  if (!node) return { files: 0, directories: 0 };
  let files = node.isDirectory ? 0 : 1;
  let directories = node.isDirectory ? 1 : 0;

  for (const child of node.children ?? []) {
    const nested = countTreeNodes(child);
    files += nested.files;
    directories += nested.directories;
  }

  return { files, directories };
}

function renderAccessBadge(access?: AgentAccessLike[]): string | undefined {
  if (!access?.length) return undefined;
  const agents = access.map((a) => {
    const rights = [a.canRead ? 'r' : '', a.canWrite ? 'w' : '', a.canList ? 'l' : '']
      .filter(Boolean)
      .join('');
    return chalk.dim(`${a.agentId}:${rights}`);
  });
  return chalk.gray('[') + agents.join(chalk.gray(' ')) + chalk.gray(']');
}

function renderAsciiFileTree(
  node: FileTreeNodeLike,
  opts: { maxDepth?: number; maxItems?: number } = {}
): string {
  const maxDepth = opts.maxDepth ?? 4;
  const maxItems = opts.maxItems ?? 60;
  const lines: string[] = [];
  let totalShown = 0;

  function walk(n: FileTreeNodeLike, prefix: string, depth: number): void {
    const children = n.children ?? [];
    const sorted = [...children].sort((a, b) => {
      if (!!a.isDirectory !== !!b.isDirectory) return a.isDirectory ? -1 : 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    for (let i = 0; i < sorted.length; i++) {
      if (totalShown >= maxItems) {
        lines.push(chalk.gray(`${prefix}… (${sorted.length - i} more)`));
        break;
      }
      const child = sorted[i];
      const isLast = i === sorted.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const name = child.name ?? '?';
      const baseLabel = child.isDirectory ? chalk.bold(name + '/') : name;
      const accessBadge = renderAccessBadge(child.agentAccess);
      const label = accessBadge ? `${baseLabel} ${accessBadge}` : baseLabel;
      lines.push(chalk.gray(prefix + connector) + label);
      totalShown++;

      if (child.isDirectory && child.children) {
        if (depth + 1 >= maxDepth) {
          if (child.children.length > 0) {
            lines.push(chalk.gray(`${childPrefix}…`));
          }
        } else {
          walk(child, childPrefix, depth + 1);
        }
      }
    }
  }

  const rootName = node.name ?? '.';
  lines.push(chalk.bold(node.isDirectory ? rootName + '/' : rootName));
  walk(node, '', 0);
  return lines.join('\n');
}

/**
 * Extracts the human-readable output from a `slash:*` tool result event.
 * Returns the `message` field if non-empty, otherwise serializes `data`.
 */
function resolveSlashCommandOutput(event: Record<string, unknown>): string | undefined {
  const toolResult = toPayloadRecord((event as { toolResult?: unknown }).toolResult);
  if (!toolResult) return undefined;
  const commandResponse = (
    toolResult as { commandResponse?: { message?: unknown; data?: unknown; status?: unknown } }
  ).commandResponse;
  if (!commandResponse) return undefined;

  if (typeof commandResponse.message === 'string' && commandResponse.message.trim()) {
    return commandResponse.message;
  }
  if (commandResponse.data !== undefined) {
    return typeof commandResponse.data === 'string'
      ? commandResponse.data
      : JSON.stringify(commandResponse.data, null, 2);
  }
  return undefined;
}

function formatToolEventMessage(event: Record<string, unknown>): string | undefined {
  const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
  const message = typeof event.message === 'string' ? event.message : undefined;
  const toolResult = toPayloadRecord((event as { toolResult?: unknown }).toolResult);
  const commandResponse = toolResult
    ? (toolResult as { commandResponse?: { data?: unknown } }).commandResponse
    : undefined;
  const resultPayload = commandResponse ? commandResponse.data : undefined;
  const payload = toPayloadRecord(resultPayload) ?? toPayloadRecord(message);

  if (toolName === 'fs_tree') {
    if (payload && 'tree' in payload) {
      const fileTree = payload as FileTreePayloadLike;
      const counts = countTreeNodes(fileTree.tree);
      return `${fileTree.path ?? '.'} · ${counts.directories} dirs · ${counts.files} files`;
    }
  }

  if (toolName === 'fs_who_should' && payload) {
    const who = payload as WhoShouldPayloadLike;
    const matches = Array.isArray(who.matches) ? who.matches : [];
    const top = matches
      .slice(0, 3)
      .map((m) => m.agentName || m.agentId || 'unknown')
      .join(', ');
    if (matches.length > 0) {
      return `matches: ${matches.length}${top ? ` (${top})` : ''}`;
    }
  }

  if (payload) {
    return summarizeGenericJsonPayload(payload);
  }

  return message;
}

function formatToolEventDetail(event: Record<string, unknown>): string | undefined {
  const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
  const phase = typeof event.toolPhase === 'string' ? event.toolPhase : undefined;
  if (phase !== 'result') return undefined;

  const toolResult = toPayloadRecord((event as { toolResult?: unknown }).toolResult);
  const commandResponse = toolResult
    ? (toolResult as { commandResponse?: { data?: unknown } }).commandResponse
    : undefined;
  const resultPayload = commandResponse ? commandResponse.data : undefined;
  const payload = toPayloadRecord(resultPayload);

  if (toolName === 'fs_tree' && payload && 'tree' in payload) {
    const tree = (payload as FileTreePayloadLike).tree;
    const denied =
      typeof (payload as { denied?: unknown }).denied === 'number'
        ? (payload as { denied: number }).denied
        : undefined;
    if (tree) {
      const rendered = renderAsciiFileTree(tree, { maxDepth: 4, maxItems: 60 });
      const footer =
        denied && denied > 0
          ? chalk.yellow(`\n  (${denied} item(s) hidden — access restricted)`)
          : '';
      return rendered + footer;
    }
  }

  return undefined;
}

function summarizeGenericJsonPayload(payload: Record<string, unknown>): string {
  if (Array.isArray(payload)) {
    return `json array (${payload.length} items)`;
  }

  const entries = Object.entries(payload);
  const keys = entries.map(([key]) => key);
  const preview = keys.slice(0, 5).join(', ');

  // Common shape: { entries: [...] }
  const entriesField = payload.entries;
  if (Array.isArray(entriesField)) {
    return `json object keys: ${preview || 'none'} · entries: ${entriesField.length}`;
  }

  return `json object keys: ${preview || 'none'}`;
}

async function handleCodeEditProposal(
  event: any,
  writeStderrLine: (text: string) => void,
  isOneShot: boolean,
  workspaceRoot: string
): Promise<void> {
  const { proposalId, description, filesChanged, additions, deletions, warnings } = event;

  // Display proposal summary
  writeStderrLine('');
  writeStderrLine(chalk.bold.cyan('📝 Code Edit Proposal'));
  writeStderrLine(chalk.gray('─'.repeat(60)));
  writeStderrLine(`${chalk.bold('ID:')} ${proposalId}`);
  writeStderrLine(`${chalk.bold('Description:')} ${description}`);
  writeStderrLine(`${chalk.bold('Files:')} ${filesChanged}`);
  writeStderrLine(
    `${chalk.bold('Changes:')} ${chalk.green(`+${additions ?? 0}`)} ${chalk.red(`-${deletions ?? 0}`)}`
  );

  if (warnings && warnings.length > 0) {
    writeStderrLine('');
    writeStderrLine(chalk.yellow('⚠️  Warnings:'));
    warnings.forEach((warning: string) => {
      writeStderrLine(chalk.yellow(`   • ${warning}`));
    });
  }

  writeStderrLine(chalk.gray('─'.repeat(60)));

  // Notify VS Code plugin (best-effort, non-blocking)
  createIdeAdapter(workspaceRoot, 'cli')
    .then((adapter) => {
      if (adapter.isConnected()) {
        return adapter
          .notifyCodeEditProposal({
            proposalId: event.proposalId ?? '',
            agentName: event.agentName ?? '',
            description: event.description ?? '',
            files: (event.files ?? []).map((f: any) => ({
              filePath: f.filePath,
              oldContent: f.oldContent ?? '',
              newContent: f.newContent ?? '',
              additions: f.additions ?? 0,
              deletions: f.deletions ?? 0,
            })),
          })
          .then(() => adapter.dispose());
      }
      adapter.dispose();
    })
    .catch(() => {
      /* VS Code not running — silent */
    });

  // In one-shot mode, just log and continue
  if (isOneShot) {
    writeStderrLine(chalk.dim('Run with --interactive to review and apply proposals'));
    return;
  }

  // Interactive mode: ask for approval
  const rl = createInterface({ input, output: process.stderr });

  try {
    const answer = await rl.question(chalk.yellow('Review this proposal? [y/n/view] (y): '));

    const choice = (answer || 'y').toLowerCase().trim();

    if (choice === 'view' || choice === 'v') {
      writeStderrLine(chalk.dim('Detailed diff view requires VS Code extension or web UI'));
      writeStderrLine(chalk.dim(`Proposal ID: ${proposalId}`));
    } else if (choice === 'y' || choice === 'yes') {
      writeStderrLine(chalk.green('✅ Proposal accepted for review'));
      writeStderrLine(chalk.dim('Use the VS Code extension or web UI to apply changes'));
    } else {
      writeStderrLine(chalk.red('❌ Proposal review skipped'));
    }
  } finally {
    rl.close();
  }

  writeStderrLine('');
}

export async function renderChat(
  client: ICliCommandClient,
  agentId: string | undefined,
  options: ChatOptions,
  mediatorLog: boolean = false,
  resolveProjectName?: (workspaceRoot: string) => Promise<string | undefined>,
  requestCommand: string = 'chat',
  requestPayload?: Record<string, unknown>
) {
  const mediatorLoggerEnabled = mediatorLog || process.env.AI_TEAM_MEDIATOR_LOG === '1';
  const frontendFileLogEnabled = isFrontendFileLogEnabled();
  const workspaceRoot = findWorkspaceRoot();
  const resolveProjectNameFromWorkspace = async (): Promise<string | undefined> => {
    if (resolveProjectName) {
      return resolveProjectName(workspaceRoot);
    }
    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const pkg = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'));
      return pkg.name as string | undefined;
    } catch {
      return undefined;
    }
  };
  const chatCommands = client.getCommands({ chat: true });
  const writeStderrLine = (text: string) => {
    process.stderr.write(`${text}\n`);
  };
  const streamOut = options.oneShot ? process.stdout : process.stderr;
  const abortControl = setupAbortController(writeStderrLine);

  // ── Agent color tracking ──────────────────────────────────────────────────
  // Colors are resolved from the agent's identity at render time.
  // The current agent identity is updated from status (agent_info) and handoff events.
  let currentAgentId: string | undefined = agentId;
  let currentAgentName: string | undefined;
  let currentAgentRole: string | undefined;
  let developerDisplayName = resolveDeveloperDisplayName(process.env);
  let tokenBurstOpen = false;
  // Chalk instance locked in at burst open — stays consistent even if agent_info
  // arrives mid-stream and updates currentAgentName to a different hash input.
  let currentBurstChalk: ReturnType<typeof agentChalk> = chalk;
  let bufferingBracketToolCall = false;
  let bracketToolBuffer = '';
  let bracketToolRenderedViaEvent = false;

  let spinnerActive = false;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;
  let spinnerText = '';
  let spinnerFrame = 0;
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  const startSpinner = (text?: string) => {
    if (options.oneShot || !process.stdout.isTTY) return;
    stopSpinner();
    spinnerText = text ?? `${currentAgentName || currentAgentId || 'Agent'} is thinking…`;
    spinnerActive = true;
    spinnerFrame = 0;
    const tick = () => {
      if (!spinnerActive) return;
      process.stdout.write(
        `\r${spinnerFrames[spinnerFrame % spinnerFrames.length]} ${chalk.dim(spinnerText)}`
      );
      spinnerFrame++;
    };
    tick();
    spinnerTimer = setInterval(tick, 80);
  };
  const stopSpinner = () => {
    if (!spinnerActive) return;
    spinnerActive = false;
    if (spinnerTimer !== undefined) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }
  };

  function resolveAgentIdentity(id?: string, name?: string) {
    return {
      id,
      name: name ?? id ?? 'unknown',
      avatar: undefined,
    };
  }

  function agentChalk(id?: string, name?: string) {
    const identity = resolveAgentIdentity(id, name);
    const hsl = generateAgentColor({
      name: identity.name,
      avatar: identity.avatar,
    });
    const hue = parseHslHue(hsl);
    if (hue !== undefined) {
      // Convert HSL(hue, 70%, 60%) to RGB for chalk v5 compatibility
      const s = 0.7,
        l = 0.6;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = l - c / 2;
      let r1 = 0,
        g1 = 0,
        b1 = 0;
      if (hue < 60) {
        r1 = c;
        g1 = x;
      } else if (hue < 120) {
        r1 = x;
        g1 = c;
      } else if (hue < 180) {
        g1 = c;
        b1 = x;
      } else if (hue < 240) {
        g1 = x;
        b1 = c;
      } else if (hue < 300) {
        r1 = x;
        b1 = c;
      } else {
        r1 = c;
        b1 = x;
      }
      const r = Math.round((r1 + m) * 255);
      const g = Math.round((g1 + m) * 255);
      const b = Math.round((b1 + m) * 255);
      return chalk.rgb(r, g, b);
    }
    return chalk;
  }

  function openTokenHeaderIfNeeded() {
    if (tokenBurstOpen) return;
    const agentName = currentAgentName || currentAgentId || 'Agent';
    const title = currentAgentRole ? `${agentName} (${currentAgentRole})` : agentName;
    // Lock in the chalk instance for this entire burst so every token uses the
    // same color — even if agent_info arrives later and updates currentAgentName.
    currentBurstChalk = agentChalk(currentAgentId, currentAgentName);
    const styledTitle = currentBurstChalk.bold(title);
    process.stdout.write(`\n${styledTitle}${chalk.dim(' → ')}${developerDisplayName}: `);
    tokenBurstOpen = true;
  }

  function writeVisibleAssistantToken(text: string) {
    if (!text) return;
    openTokenHeaderIfNeeded();
    process.stdout.write(currentBurstChalk(text));
  }

  function handleAssistantTokenChunk(deltaText: string) {
    if (!deltaText) return;
    if (bufferingBracketToolCall) {
      bracketToolBuffer += deltaText;
      return;
    }

    const markerIndex = deltaText.toLowerCase().indexOf('[tool:');
    if (markerIndex === -1) {
      writeVisibleAssistantToken(deltaText);
      return;
    }

    const visiblePrefix = deltaText.slice(0, markerIndex);
    if (visiblePrefix) {
      writeVisibleAssistantToken(visiblePrefix);
    }

    bufferingBracketToolCall = true;
    bracketToolBuffer += deltaText.slice(markerIndex);
  }

  function flushBracketToolBufferFallbackIfNeeded() {
    if (!bufferingBracketToolCall) return;
    const buffered = bracketToolBuffer;
    bufferingBracketToolCall = false;
    bracketToolBuffer = '';
    if (bracketToolRenderedViaEvent) return;
    if (!buffered.trim()) return;
    writeVisibleAssistantToken(buffered);
  }

  try {
    startSpinner();
    const sessionClient = client.withQuestionService(
      createChatQuestionResponders(
        abortControl.signal,
        startSpinner,
        stopSpinner,
        resolveProjectNameFromWorkspace,
        chatCommands
      )
    );
    for await (const event of sessionClient.streamInteraction(
      {
        command: requestCommand,
        payload:
          requestPayload ??
          {
            employeeId: agentId,
            options,
          },
      },
      {
        workspaceRoot,
        invocationSurface: 'cli' as const,
        calledByHuman: true,
        signal: abortControl.signal,
        logger:
          mediatorLoggerEnabled || frontendFileLogEnabled
            ? (entry: { channel: string; event: unknown }) => {
                if (frontendFileLogEnabled) {
                  writeFrontendDebugLog({
                    command: 'chat',
                    channel: entry.channel,
                    event: entry.event,
                  });
                }
                try {
                  if (mediatorLoggerEnabled) {
                    writeStderrLine(
                      `${chalk.gray('[frontend:mediator-log]')} ${JSON.stringify(entry)}`
                    );
                  }
                } catch {
                  if (mediatorLoggerEnabled) {
                    writeStderrLine(
                      `${chalk.gray('[frontend:mediator-log]')} ${JSON.stringify(entry)}`
                    );
                  }
                }
              }
            : undefined,
      }
    )) {
      if (event.kind === 'token') {
        stopSpinner();
        // Always write tokens to stdout — same stream as readline's prompt,
        // guaranteeing correct ordering on Windows (ConPTY merges stdout/stderr
        // but they may flush in non-deterministic order).
        handleAssistantTokenChunk(event.text);
        continue;
      }

      tokenBurstOpen = false;

      if (event.kind === 'done') {
        flushBracketToolBufferFallbackIfNeeded();
        continue;
      }

      if (event.kind === 'aborted') {
        stopSpinner();
        flushBracketToolBufferFallbackIfNeeded();
        writeStderrLine(chalk.yellow('Chat aborted.'));
        process.exitCode = 130;
        return;
      }

      if (event.kind === 'status' && event.message) {
        if (mediatorLoggerEnabled) {
          writeStderrLine(chalk.dim(`[backend:mediator:${event.command}] ${event.message}`));
        }
        continue;
      }

      if (event.kind === 'agent_info') {
        currentAgentId = event.agentId || currentAgentId;
        currentAgentName = event.agentName.trim() || currentAgentName;
        currentAgentRole = event.agentRole?.trim() || currentAgentRole;
        if (event.developerName?.trim()) {
          developerDisplayName = event.developerName.trim();
        }
        // Update spinner text now that we know the agent's name
        if (spinnerActive) {
          spinnerText = `${currentAgentName || currentAgentId || 'Agent'} is thinking…`;
        }
        if (mediatorLoggerEnabled && event.message) {
          writeStderrLine(chalk.dim(`[backend:mediator:${event.command}] ${event.message}`));
        }
        continue;
      }

      if (event.kind === 'tool') {
        stopSpinner();
        const phase = event.toolPhase || 'event';

        // Slash command results go directly to stdout — they ARE the response.
        if (
          typeof event.toolName === 'string' &&
          event.toolName.startsWith('slash:') &&
          (phase === 'result' || phase === 'error')
        ) {
          const slashOutput = resolveSlashCommandOutput(event);
          if (slashOutput) {
            process.stdout.write(slashOutput.endsWith('\n') ? slashOutput : slashOutput + '\n');
          }
          continue;
        }

        if (
          bufferingBracketToolCall &&
          (phase === 'result' || phase === 'error' || phase === 'denied')
        ) {
          bracketToolRenderedViaEvent = true;
          bufferingBracketToolCall = false;
          bracketToolBuffer = '';
        }
        const formatted = formatToolEventMessage(event as unknown as Record<string, unknown>);
        const suffix = formatted ? chalk.gray(` — ${formatted}`) : '';
        writeStderrLine(
          `${chalk.cyan(`[backend:tool:${phase}]`)} ${chalk.white(event.toolName)}${suffix}`
        );
        const detail = formatToolEventDetail(event as unknown as Record<string, unknown>);
        if (detail) writeStderrLine(detail);
        // After a tool result, the agent will continue thinking — restart the spinner
        if (phase === 'result' || phase === 'error' || phase === 'denied') {
          startSpinner();
        }
        continue;
      }

      // Handle code edit proposals
      if (event.kind === 'code_edit_proposal') {
        stopSpinner();
        await handleCodeEditProposal(
          event,
          writeStderrLine,
          options.oneShot || false,
          workspaceRoot
        );
        continue;
      }

      // Handle agent handoff — print a single clean transition line
      if (event.kind === 'handoff') {
        stopSpinner();
        const e = event;
        const from = e.fromAgentName || e.fromAgentId;
        const to = e.toAgentName || e.toAgentId;
        currentAgentId = e.toAgentId || currentAgentId;
        currentAgentName = e.toAgentName || e.toAgentId || currentAgentName;
        currentAgentRole = e.toAgentRole || currentAgentRole;
        const note = e.handoffNote ? `: ${e.handoffNote}` : '';
        const fromStyled = agentChalk(e.fromAgentId, e.fromAgentName).bold(String(from));
        const toStyled = agentChalk(e.toAgentId, e.toAgentName).bold(String(to));
        writeStderrLine('');
        writeStderrLine(fromStyled + chalk.dim(' → ') + toStyled + chalk.dim(note));
        if (e.briefingContent) {
          writeStderrLine('');
          writeStderrLine(chalk.italic.gray(e.briefingContent));
        }
        writeStderrLine('');
        continue;
      }

      if (event.kind === 'question') {
        if (frontendFileLogEnabled) {
          writeFrontendDebugLog({ command: 'chat', event });
        }
        if (mediatorLoggerEnabled) {
          writeStderrLine(
            chalk.yellow(`[frontend:question:${event.questionType || 'input'}] ${event.message}`)
          );
        }
        continue;
      }

      if (event.kind === 'log') {
        stopSpinner();
        const line = `${event.message}\n`;
        if (event.level === 'error') {
          process.stderr.write(chalk.red(line));
        } else if (event.level === 'warn') {
          process.stderr.write(chalk.yellow(line));
        } else {
          streamOut.write(chalk.dim(line));
        }
        continue;
      }

      if (event.kind === 'error') {
        stopSpinner();
        flushBracketToolBufferFallbackIfNeeded();
        if (abortControl.wasAborted() || isAbortLikeError(event.message)) {
          writeStderrLine(chalk.yellow('Chat aborted.'));
          process.exitCode = 130;
          return;
        }
        throw new Error(event.message);
      }

      if (options.oneShot) {
        handleOneShotEvent(event, writeStderrLine);
      }
    }
  } catch (error) {
    if (abortControl.wasAborted() || isAbortLikeError(error)) {
      flushBracketToolBufferFallbackIfNeeded();
      writeStderrLine(chalk.yellow('Chat aborted.'));
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    stopSpinner();
    abortControl.dispose();
  }
}
