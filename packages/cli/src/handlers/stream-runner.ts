import type {
  InteractionRequest,
  InteractionContext,
} from '@ai-team/api-contracts';
import type { IServiceContainer } from '@ai-team/core';
import type { ICliCommandClient } from '../cli-command-client.js';
import { exec } from 'node:child_process';
import chalk from 'chalk';
import { createQuestionResponders } from './question-responders.js';
import {
  CLI_RESULT_HANDLER_REGISTRY_TOKEN,
  type ICliResultHandlerRegistry,
} from './result-renderers.js';

interface StreamRunnerOptions {
  showStatus?: boolean;
  resultHandler?: (data: unknown) => void;
  serviceContainer?: IServiceContainer;
  rendererOptions?: unknown;
  interactionContext?: InteractionContext;
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

export async function runCommandStream(
  client: ICliCommandClient,
  request: InteractionRequest,
  options: StreamRunnerOptions = {}
): Promise<unknown | undefined> {
  const abortControl = setupAbortController();
  let lastErrorLogMessage: string | undefined;
  let resultData: unknown | undefined;

  try {
    const interactionContext: InteractionContext = {
      invocationSurface: 'cli',
      calledByHuman: true,
      ...(options.interactionContext ?? {}),
    } as InteractionContext;

    for await (const event of client.streamInteraction(request, {
      ...createQuestionResponders(),
      signal: abortControl.signal,
      ...interactionContext,
    })) {
      if (event.kind === 'token') {
        process.stdout.write(event.text);
        continue;
      }

      if (event.kind === 'aborted') {
        process.stderr.write(chalk.yellow('\nCommand aborted.\n'));
        process.exitCode = 130;
        return;
      }

      if (event.kind === 'log') {
        const line = `${event.message}\n`;
        if (event.level === 'error') {
          lastErrorLogMessage = event.message;
          process.stderr.write(chalk.red(line));
        } else {
          process.stdout.write(line);
        }
        continue;
      }

      if (event.kind === 'avatar-preview') {
        const resultHandlerRegistry = options.serviceContainer?.tryResolve(
          CLI_RESULT_HANDLER_REGISTRY_TOKEN
        ) as ICliResultHandlerRegistry | undefined;
        const avatarPreviewHandler = resultHandlerRegistry?.resolveAvatarPreview();

        if (avatarPreviewHandler) {
          await avatarPreviewHandler({
            agentName: event.agentName,
            previewPath: event.previewPath,
          });
          continue;
        }

        process.stdout.write(
          chalk.cyan(`\n🖼  Avatar preview for ${event.agentName}: ${event.previewPath}\n`)
        );
        openInSystemViewer(event.previewPath);
        continue;
      }

      if (event.kind === 'result') {
        resultData = event.data as unknown;
        if (resultData === undefined) {
          continue;
        }

        if (options.resultHandler) {
          options.resultHandler(resultData);
          continue;
        }

        const resultHandlerRegistry = options.serviceContainer?.tryResolve(
          CLI_RESULT_HANDLER_REGISTRY_TOKEN
        ) as ICliResultHandlerRegistry | undefined;
        const resultHandler = resultHandlerRegistry?.resolve(request.command);

        if (resultHandler) {
          await resultHandler(resultData, options.rendererOptions);
          continue;
        }

        process.stdout.write(`${JSON.stringify(resultData, null, 2)}\n`);
        continue;
      }

      if (event.kind === 'status' && options.showStatus && event.message) {
        process.stderr.write(`[service:${event.command}] ${event.message}\n`);
        continue;
      }

      if (event.kind === 'error') {
        if (abortControl.wasAborted() || isAbortLikeError(event.message)) {
          process.stderr.write(chalk.yellow('\nCommand aborted.\n'));
          process.exitCode = 130;
          return;
        }

        if (lastErrorLogMessage && lastErrorLogMessage === event.message) {
          process.exitCode = 1;
          return;
        }
        throw new Error(chalk.red(event.message));
      }
    }
  } catch (error) {
    if (abortControl.wasAborted() || isAbortLikeError(error)) {
      process.stderr.write(chalk.yellow('\nCommand aborted.\n'));
      process.exitCode = 130;
      return;
    }

    throw error;
  } finally {
    abortControl.dispose();
  }

  return resultData;
}

function openInSystemViewer(filePath: string) {
  const platform = process.platform;
  const cmd =
    platform === 'win32'
      ? `start "" "${filePath}"`
      : platform === 'darwin'
        ? `open "${filePath}"`
        : `xdg-open "${filePath}"`;

  exec(cmd, (err) => {
    if (err) {
      process.stderr.write(chalk.yellow(`Could not open preview: ${err.message}\n`));
    }
  });
}
