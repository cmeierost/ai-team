import type { InitOptions } from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';
import chalk from 'chalk';
import { isFrontendFileLogEnabled, writeFrontendDebugLog } from './debug-log.js';

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
    process.stderr.write(chalk.yellow(`\nReceived ${signalName}, aborting...\n`));
    controller.abort(new Error(`Aborted by ${signalName}`));
    forceExitTimer = setTimeout(() => {
      process.stderr.write(chalk.yellow('\nAbort timed out, forcing exit.\n'));
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

export async function renderInit(client: ICliCommandClient, options: InitOptions) {
  const abortControl = setupAbortController();
  const frontendFileLogEnabled = isFrontendFileLogEnabled();

  try {
    for await (const event of client.streamInteraction(
      {
        command: 'init',
        payload: { options },
      },
      {
        signal: abortControl.signal,
        logger:
          frontendFileLogEnabled
            ? (entry: { channel: string; event: unknown }) => {
                if (frontendFileLogEnabled) {
                  writeFrontendDebugLog({
                    command: 'init',
                    channel: entry.channel,
                    event: entry.event,
                  });
                }
              }
            : undefined,
      }
    )) {
      if (event.kind === 'token') {
        process.stdout.write(event.text);
        continue;
      }

      if (event.kind === 'question') {
        if (frontendFileLogEnabled) {
          writeFrontendDebugLog({ command: 'init', event });
        }
        continue;
      }

      if (event.kind === 'aborted') {
        process.stderr.write(chalk.yellow('Init aborted.\n'));
        process.exitCode = 130;
        return;
      }

      if (event.kind === 'log') {
        if (event.level === 'error') {
          process.stderr.write(`${event.message}\n`);
        } else {
          process.stdout.write(`${event.message}\n`);
        }
        continue;
      }

      if (event.kind === 'status' && event.message) {
        process.stderr.write(chalk.dim('[backend:service:init] ' + event.message) + '\n');
        continue;
      }

      if (event.kind === 'error') {
        if (abortControl.wasAborted() || isAbortLikeError(event.message)) {
          process.stderr.write(chalk.yellow('Init aborted.\n'));
          process.exitCode = 130;
          return;
        }
        throw new Error(event.message);
      }
    }
  } catch (error) {
    if (abortControl.wasAborted() || isAbortLikeError(error)) {
      process.stderr.write(chalk.yellow('Init aborted.\n'));
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    abortControl.dispose();
  }
}
