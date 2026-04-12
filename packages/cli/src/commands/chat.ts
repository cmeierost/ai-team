import type {
  IAiTeamMediator,
  ChatOptions,
  MediatorEvent,
  AiTeamCommandName,
} from '@ai-team/api-client';
import type {
  MediatorContext,
  QuestionConfirmRequest,
  QuestionInputRequest,
} from '@ai-team/api-client';
import { generateAgentColor, parseHslHue } from '@ai-team/infrastructure';
import { createIdeAdapter } from '@ai-team/infrastructure';
import { findWorkspaceRoot, IN_CHAT_COMMAND_REGISTRY } from '@ai-team/service';
import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isFrontendFileLogEnabled, writeFrontendDebugLog } from './debug-log.js';
import { askWithSlashSuggestions } from '../utils/slash-prompt.js';

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
 */
function slashCompleter(line: string): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const fragment = line.slice(1).toLowerCase();
  const hits = IN_CHAT_COMMAND_REGISTRY.flatMap((cmd) => [cmd.key, ...(cmd.aliases ?? [])])
    .filter((key) => key.startsWith(fragment))
    .map((key) => `/${key} `);
  return [hits.length ? hits : [], line];
}

async function askLine(message: string, signal?: AbortSignal): Promise<string> {
  const rl = createInterface({ input, output, completer: slashCompleter });
  try {
    return (await rl.question(`${message} `, { signal })).trim();
  } finally {
    rl.close();
  }
}

function createChatQuestionResponders(
  signal: AbortSignal,
  onAnswered?: () => void
): Pick<MediatorContext, 'questionInput' | 'questionConfirm'> {
  return {
    questionInput: async (request: QuestionInputRequest) => {
      while (true) {
        const answer = await askWithSlashSuggestions(request.message, signal);
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
    questionConfirm: async (request: QuestionConfirmRequest) => {
      const defaultValue = request.default ?? false;
      const suffix = defaultValue ? '[Y/n]' : '[y/N]';

      while (true) {
        const raw = (await askLine(`${request.message} ${suffix}`, signal)).toLowerCase();
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
  };
}

function handleOneShotEvent(
  event: MediatorEvent<AiTeamCommandName>,
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
    const formatted = formatToolEventMessage(event as Record<string, unknown>);
    const suffix = formatted ? ` — ${formatted}` : '';
    writeStderrLine(chalk.cyan(`[backend:tool:${phase}] ${event.toolName}${suffix}`));
    return;
  }

  if (event.kind === 'error') {
    throw new Error(event.message);
  }
}

interface FileTreeNodeLike {
  isDirectory?: boolean;
  children?: FileTreeNodeLike[];
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

function formatToolEventMessage(event: Record<string, unknown>): string | undefined {
  const toolName = typeof event.toolName === 'string' ? event.toolName : undefined;
  const message = typeof event.message === 'string' ? event.message : undefined;
  const toolResult = toPayloadRecord((event as { toolResult?: unknown }).toolResult);
  const resultPayload = toolResult ? (toolResult as { result?: unknown }).result : undefined;
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

export async function chatCommand(
  client: IAiTeamMediator,
  agentId: string | undefined,
  options: ChatOptions,
  mediatorLog: boolean = false
) {
  const mediatorLoggerEnabled = mediatorLog || process.env.AI_TEAM_MEDIATOR_LOG === '1';
  const frontendFileLogEnabled = isFrontendFileLogEnabled();
  const workspaceRoot = findWorkspaceRoot();
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

  function colorize(text: string, id?: string, name?: string): string {
    return agentChalk(id, name)(text);
  }

  try {
    startSpinner();
    for await (const event of client.streamInteraction(
      {
        command: 'chat',
        payload: {
          employeeId: agentId,
          options,
        },
      },
      {
        ...createChatQuestionResponders(abortControl.signal, startSpinner),
        signal: abortControl.signal,
        logger:
          mediatorLoggerEnabled || frontendFileLogEnabled
            ? (entry) => {
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
                    writeStderrLine(`${chalk.gray('[frontend:mediator-log]')} ${String(entry)}`);
                  }
                }
              }
            : undefined,
      }
    )) {
      if (event.kind === 'token') {
        if (!tokenBurstOpen) {
          stopSpinner();
          const agentName = currentAgentName || currentAgentId || 'Agent';
          const title = currentAgentRole ? `${agentName} (${currentAgentRole})` : agentName;
          const styledTitle = agentChalk(currentAgentId, currentAgentName).bold(title);
          process.stdout.write(`\n${styledTitle}${chalk.dim(' → ')}${developerDisplayName}: `);
          tokenBurstOpen = true;
        }
        // Always write tokens to stdout — same stream as readline's prompt,
        // guaranteeing correct ordering on Windows (ConPTY merges stdout/stderr
        // but they may flush in non-deterministic order).
        process.stdout.write(colorize(event.text, currentAgentId, currentAgentName));
        continue;
      }

      tokenBurstOpen = false;

      if (event.kind === 'aborted') {
        stopSpinner();
        writeStderrLine(chalk.yellow('Chat aborted.'));
        process.exitCode = 130;
        return;
      }

      if (event.kind === 'status' && event.message) {
        if (options.oneShot || mediatorLoggerEnabled) {
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
        if ((options.oneShot || mediatorLoggerEnabled) && event.message) {
          writeStderrLine(chalk.dim(`[backend:mediator:${event.command}] ${event.message}`));
        }
        continue;
      }

      if (event.kind === 'tool') {
        stopSpinner();
        const phase = event.toolPhase || 'event';
        const formatted = formatToolEventMessage(event as unknown as Record<string, unknown>);
        const suffix = formatted ? chalk.gray(` — ${formatted}`) : '';
        writeStderrLine(
          `${chalk.cyan(`[backend:tool:${phase}]`)} ${chalk.white(event.toolName)}${suffix}`
        );
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
        if (options.oneShot || mediatorLoggerEnabled) {
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
