import type { AiTeamClient, ChatOptions } from '@ai-team/api-client';
import type {
  MediatorContext,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-client';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { isFrontendFileLogEnabled, writeFrontendDebugLog } from './debug-log.js';

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

async function askLine(message: string, signal?: AbortSignal): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(`${message} `, { signal })).trim();
  } finally {
    rl.close();
  }
}

function createChatQuestionResponders(signal: AbortSignal): Pick<
  MediatorContext,
  'questionInput' | 'questionConfirm' | 'questionSelect' | 'questionPassword' | 'questionChecklist'
> {
  return {
    questionInput: async (request: QuestionInputRequest) => {
      while (true) {
        const value = await askLine(request.message, signal);
        if (!request.validate) {
          return value;
        }

        const validation = await request.validate(value);
        if (validation === true || validation === undefined) {
          return value;
        }

        if (typeof validation === 'string' && validation.trim().length > 0) {
          process.stderr.write(`${validation}\n`);
        }
      }
    },
    questionConfirm: async (request: QuestionConfirmRequest) => {
      const defaultValue = request.default ?? false;
      const suffix = defaultValue ? '[Y/n]' : '[y/N]';

      while (true) {
        const raw = (await askLine(`${request.message} ${suffix}`, signal)).toLowerCase();
        if (!raw) {
          return defaultValue;
        }
        if (raw === 'y' || raw === 'yes') {
          return true;
        }
        if (raw === 'n' || raw === 'no') {
          return false;
        }
        process.stderr.write('Please answer yes or no.\n');
      }
    },
    questionSelect: async (request: QuestionSelectRequest) => {
      process.stdout.write(`${request.message}\n`);
      request.choices.forEach((choice, index) => {
        process.stdout.write(`  ${index + 1}) ${choice.name}\n`);
      });

      while (true) {
        const answer = await askLine('Select a number:', signal);
        const selectedIndex = Number.parseInt(answer, 10) - 1;
        if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < request.choices.length) {
          return request.choices[selectedIndex]!.value;
        }
        process.stderr.write('Invalid selection.\n');
      }
    },
    questionPassword: async (request: QuestionPasswordRequest) => {
      return askLine(request.message, signal);
    },
    questionChecklist: async (request: QuestionChecklistRequest) => {
      process.stdout.write(`${request.message}\n`);
      request.choices.forEach((choice, index) => {
        process.stdout.write(`  ${index + 1}) ${choice.name}\n`);
      });

      while (true) {
        const answer = await askLine('Select numbers separated by comma (or empty for none):', signal);
        if (!answer) {
          return [];
        }

        const indices = answer
          .split(',')
          .map(part => Number.parseInt(part.trim(), 10) - 1)
          .filter(index => Number.isInteger(index));

        const inRange = indices.every(index => index >= 0 && index < request.choices.length);
        if (!inRange) {
          process.stderr.write('Invalid checklist selection.\n');
          continue;
        }

        const values = [...new Set(indices)].map(index => request.choices[index]!.value);
        return values;
      }
    },
  };
}

function handleOneShotEvent(
  event: Awaited<ReturnType<AiTeamClient['stream']>> extends AsyncIterable<infer TEvent> ? TEvent : never,
  writeStderrLine: (text: string) => void,
): void {
  if (event.kind === 'status' && event.message) {
    writeStderrLine(chalk.dim(`[backend:mediator:${event.command}] ${event.message}`));
    return;
  }

  if (event.kind === 'question') {
    writeStderrLine(chalk.yellow(`[frontend:question:${event.questionType || 'input'}] ${event.message}`));
    return;
  }

  if (event.kind === 'tool') {
    const phase = event.toolPhase || 'event';
    const suffix = event.message ? ' — ' + event.message : '';
    writeStderrLine(chalk.cyan(`[backend:tool:${phase}] ${event.toolName}${suffix}`));
    return;
  }

  if (event.kind === 'error') {
    throw new Error(event.message);
  }
}

function isEssentialInteractiveInfo(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }

  return /^(loading |validating |initializing |connecting to |connected to |chat with |switched to |type "\/help"|type "exit"|\(\d+ previous messages loaded\)|goodbye!)/i.test(normalized);
}

async function handleCodeEditProposal(
  event: any,
  writeStderrLine: (text: string) => void,
  isOneShot: boolean
): Promise<void> {
  const { proposalId, description, filesChanged, additions, deletions, warnings } = event;

  // Display proposal summary
  writeStderrLine('');
  writeStderrLine(chalk.bold.cyan('📝 Code Edit Proposal'));
  writeStderrLine(chalk.gray('─'.repeat(60)));
  writeStderrLine(`${chalk.bold('ID:')} ${proposalId}`);
  writeStderrLine(`${chalk.bold('Description:')} ${description}`);
  writeStderrLine(`${chalk.bold('Files:')} ${filesChanged}`);
  writeStderrLine(`${chalk.bold('Changes:')} ${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)}`);
  
  if (warnings && warnings.length > 0) {
    writeStderrLine('');
    writeStderrLine(chalk.yellow('⚠️  Warnings:'));
    warnings.forEach((warning: string) => {
      writeStderrLine(chalk.yellow(`   • ${warning}`));
    });
  }
  
  writeStderrLine(chalk.gray('─'.repeat(60)));

  // In one-shot mode, just log and continue
  if (isOneShot) {
    writeStderrLine(chalk.dim('Run with --interactive to review and apply proposals'));
    return;
  }

  // Interactive mode: ask for approval
  const rl = createInterface({ input, output: process.stderr });
  
  try {
    const answer = await rl.question(
      chalk.yellow('Review this proposal? [y/n/view] (y): ')
    );
    
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

export async function chatCommand(client: AiTeamClient, agentId: string | undefined, options: ChatOptions, mediatorLog: boolean = false) {
  const mediatorLoggerEnabled = mediatorLog || process.env.AI_TEAM_MEDIATOR_LOG === '1';
  const frontendFileLogEnabled = isFrontendFileLogEnabled();
  const writeStderrLine = (text: string) => {
    process.stderr.write(`${text}\n`);
  };
  const streamOut = options.oneShot ? process.stdout : process.stderr;
  const abortControl = setupAbortController(writeStderrLine);

  try {
    for await (const event of client.stream({
      command: 'chat',
      payload: {
        employeeId: agentId,
        options,
      },
    }, {
      ...createChatQuestionResponders(abortControl.signal),
      signal: abortControl.signal,
      logger: mediatorLoggerEnabled || frontendFileLogEnabled
        ? (entry) => {
            if (frontendFileLogEnabled) {
              writeFrontendDebugLog({ command: 'chat', channel: entry.channel, event: entry.event });
            }
            try {
              if (mediatorLoggerEnabled) {
                writeStderrLine(`${chalk.gray('[frontend:mediator-log]')} ${JSON.stringify(entry)}`);
              }
            } catch {
              if (mediatorLoggerEnabled) {
                writeStderrLine(`${chalk.gray('[frontend:mediator-log]')} ${String(entry)}`);
              }
            }
          }
        : undefined,
    })) {
      if (event.kind === 'token') {
        streamOut.write(event.text);
        continue;
      }

      if (event.kind === 'aborted') {
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

      if (event.kind === 'tool') {
        const phase = event.toolPhase || 'event';
        const suffix = event.message ? chalk.gray(` — ${event.message}`) : '';
        writeStderrLine(`${chalk.cyan(`[backend:tool:${phase}]`)} ${chalk.white(event.toolName)}${suffix}`);
        continue;
      }

      // Handle code edit proposals
      if ('kind' in event && (event as any).kind === 'code_edit_proposal') {
        await handleCodeEditProposal(event as any, writeStderrLine, options.oneShot || false);
        continue;
      }

      if (event.kind === 'question') {
        if (frontendFileLogEnabled) {
          writeFrontendDebugLog({ command: 'chat', event });
        }
        if (options.oneShot || mediatorLoggerEnabled) {
          writeStderrLine(chalk.yellow(`[frontend:question:${event.questionType || 'input'}] ${event.message}`));
        }
        continue;
      }

      if (event.kind === 'log') {
        const line = `${event.message}\n`;
        if (event.level === 'error') {
          process.stderr.write(chalk.red(line));
        } else if (event.level === 'warn') {
          process.stderr.write(chalk.yellow(line));
        } else {
          if (mediatorLoggerEnabled || options.oneShot || isEssentialInteractiveInfo(event.message)) {
            streamOut.write(chalk.dim(line));
          }
        }
        continue;
      }

      if (event.kind === 'error') {
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
    abortControl.dispose();
  }
}
