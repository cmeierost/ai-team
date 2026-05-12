import type {
  DoIHavePermissionResponse,
  PermissionOverlapReport,
  WhoHasPermissionResponse,
} from '@ai-team/api-contracts';
import type { IContainerToken, IServiceContainer } from '@ai-team/core';
import { exec } from 'node:child_process';
import chalk from 'chalk';
import { renderAccessCan, renderAccessOverlap, renderAccessWho } from './access.js';

export type CliResultHandler = (
  data: unknown,
  options?: unknown
) => void | Promise<void>;

export type AvatarPreviewPayload = {
  agentName: string;
  previewPath: string;
};

export type CliAvatarPreviewHandler = (
  payload: AvatarPreviewPayload
) => void | Promise<void>;

export interface ICliResultHandlerRegistry {
  register<TCommand extends string>(
    command: TCommand,
    handler: CliResultHandler
  ): void;
  resolve<TCommand extends string>(
    command: TCommand
  ): CliResultHandler | undefined;
  registerAvatarPreview(handler: CliAvatarPreviewHandler): void;
  resolveAvatarPreview(): CliAvatarPreviewHandler | undefined;
}

class CliResultHandlerRegistry implements ICliResultHandlerRegistry {
  private readonly handlers = new Map<string, CliResultHandler>();
  private avatarPreviewHandler: CliAvatarPreviewHandler | undefined;

  register<TCommand extends string>(
    command: TCommand,
    handler: CliResultHandler
  ): void {
    this.handlers.set(command, handler as CliResultHandler);
  }

  resolve<TCommand extends string>(
    command: TCommand
  ): CliResultHandler | undefined {
    return this.handlers.get(command);
  }

  registerAvatarPreview(handler: CliAvatarPreviewHandler): void {
    this.avatarPreviewHandler = handler;
  }

  resolveAvatarPreview(): CliAvatarPreviewHandler | undefined {
    return this.avatarPreviewHandler;
  }
}

export const CLI_RESULT_HANDLER_REGISTRY_TOKEN: IContainerToken<ICliResultHandlerRegistry> = {
  id: 'CliResultHandlerRegistry',
  toString: () => 'Token(CliResultHandlerRegistry)',
};

export function registerCliResultHandlers(container: IServiceContainer): void {
  const existing = container.tryResolve(CLI_RESULT_HANDLER_REGISTRY_TOKEN);
  if (existing) {
    registerDefaultResultHandlers(existing);
    return;
  }

  const registry = new CliResultHandlerRegistry();
  registerDefaultResultHandlers(registry);
  container.registerInstance(CLI_RESULT_HANDLER_REGISTRY_TOKEN, registry);
}

function registerDefaultResultHandlers(registry: ICliResultHandlerRegistry): void {
  registry.registerAvatarPreview(({ agentName, previewPath }) => {
    process.stdout.write(chalk.cyan(`\n🖼  Avatar preview for ${agentName}: ${previewPath}\n`));
    openInSystemViewer(previewPath);
  });

  registry.register('accessWho', (data, options) =>
    renderAccessWho(data as WhoHasPermissionResponse, options as { json?: boolean })
  );

  registry.register('accessCan', (data, options) =>
    renderAccessCan(data as DoIHavePermissionResponse, options as { json?: boolean })
  );

  registry.register('accessOverlap', (data, options) =>
    renderAccessOverlap(
      data as PermissionOverlapReport,
      options as {
        mode?: 'files' | 'patterns';
        right?: 'read' | 'write' | 'list';
        agent?: string;
        json?: boolean;
      }
    )
  );
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
