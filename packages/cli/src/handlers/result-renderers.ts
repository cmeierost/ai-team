import type {
  Agent,
  CodeEditListResponse,
  DbMigrateResponse,
  DbStatusResponse,
  DoIHavePermissionResponse,
  FilesPatternsResponse,
  ListToolsResponse,
  PermissionOverlapReport,
  SearchAgentsResponse,
  SearchSkillsResponse,
  SystemInfoResponse,
  UpdateAgentSkillResponse,
  WhoHasPermissionResponse,
} from '@ai-team/api-contracts';
import { Token, type IServiceContainer } from '@ai-team/core';
import { exec } from 'node:child_process';
import chalk from 'chalk';
import { renderAccessCan, renderAccessOverlap, renderAccessWho } from './access.js';
import {
  renderCodeEditList,
  renderCodeEditApprove,
  renderCodeEditReject,
  renderCodeEditApply,
} from './code-edit.js';
import { renderDbStatus, renderDbMigrate } from './db.js';
import { renderFilesPatterns } from './files.js';
import { renderPatchApply } from './patch.js';
import { renderAgentList } from './list.js';
import { renderSearchResults } from './search.js';
import { renderSysinfo } from './sysinfo.js';
import { renderToolsList } from './tools.js';
import { renderSkillsList, renderSkillsAdd, renderSkillsRemove } from './skills.js';

export type CliResultHandler = (data: unknown, options?: unknown) => void | Promise<void>;

export type AvatarPreviewPayload = {
  agentName: string;
  previewPath: string;
};

export type CliAvatarPreviewHandler = (payload: AvatarPreviewPayload) => void | Promise<void>;

export interface ICliResultHandlerRegistry {
  register<TCommand extends string>(command: TCommand, handler: CliResultHandler): void;
  resolve<TCommand extends string>(command: TCommand): CliResultHandler | undefined;
  registerAvatarPreview(handler: CliAvatarPreviewHandler): void;
  resolveAvatarPreview(): CliAvatarPreviewHandler | undefined;
}

class CliResultHandlerRegistry implements ICliResultHandlerRegistry {
  private readonly handlers = new Map<string, CliResultHandler>();
  private avatarPreviewHandler: CliAvatarPreviewHandler | undefined;

  register<TCommand extends string>(command: TCommand, handler: CliResultHandler): void {
    this.handlers.set(command, handler as CliResultHandler);
  }

  resolve<TCommand extends string>(command: TCommand): CliResultHandler | undefined {
    return this.handlers.get(command);
  }

  registerAvatarPreview(handler: CliAvatarPreviewHandler): void {
    this.avatarPreviewHandler = handler;
  }

  resolveAvatarPreview(): CliAvatarPreviewHandler | undefined {
    return this.avatarPreviewHandler;
  }
}

export const CLI_RESULT_HANDLER_REGISTRY_TOKEN: Token<ICliResultHandlerRegistry> =
  new Token<ICliResultHandlerRegistry>('CliResultHandlerRegistry');

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

  registry.register('access-who', (data, options) =>
    renderAccessWho(data as WhoHasPermissionResponse, options as { json?: boolean })
  );

  registry.register('access-can', (data, options) =>
    renderAccessCan(data as DoIHavePermissionResponse, options as { json?: boolean })
  );

  registry.register('access-overlap', (data, options) =>
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

  registry.register('fs-patterns', (data, options) =>
    renderFilesPatterns(data as FilesPatternsResponse, options as { json?: boolean })
  );

  registry.register('edit-list', (data, options) =>
    renderCodeEditList(data as CodeEditListResponse, options as { json?: boolean })
  );

  registry.register('edit-approve', (data) =>
    renderCodeEditApprove(data as { proposalId: string })
  );

  registry.register('edit-reject', (data) => renderCodeEditReject(data as { proposalId: string }));

  registry.register('edit-apply', (data) =>
    renderCodeEditApply(data as { proposalId: string; files: string[] })
  );

  registry.register('db-status', (data) => renderDbStatus(data as DbStatusResponse));

  registry.register('db-migrate', (data) => renderDbMigrate(data as DbMigrateResponse));

  registry.register('edit-patch', (data) =>
    renderPatchApply(data as { proposalId: string; patchedLines: number })
  );

  registry.register('team-list', (data, options) =>
    renderAgentList(data as Agent[], options as { json?: boolean })
  );

  registry.register('team-search', (data, options) =>
    renderSearchResults(data as SearchAgentsResponse, options as { json?: boolean })
  );

  registry.register('system-info', (data, options) =>
    renderSysinfo(data as SystemInfoResponse, options as { json?: boolean })
  );

  registry.register('tool-list', (data, options) =>
    renderToolsList(data as ListToolsResponse, options as { json?: boolean })
  );

  registry.register('skills-list', (data, options) =>
    renderSkillsList(data as SearchSkillsResponse, options as { json?: boolean })
  );

  registry.register('skills-add', (data, options) =>
    renderSkillsAdd(data as UpdateAgentSkillResponse, options as { json?: boolean })
  );

  registry.register('skills-remove', (data, options) =>
    renderSkillsRemove(data as UpdateAgentSkillResponse, options as { json?: boolean })
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
