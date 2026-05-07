import path from 'node:path';
import type { ICommand, CommandRuntime, IMessageStorage } from '@ai-team/core';
import type { DbStatusResponse } from '@ai-team/api-contracts';
import { dbStatusCommandAsync } from './db.js';

export class DbStatusCommand implements ICommand<Record<string, never>, void, DbStatusResponse> {
  readonly key = 'dbStatus';
  readonly cli = { command: 'db:status' };
  readonly description = 'Show database status and statistics';
  readonly availableIn = { cli: true };

  constructor(private readonly storage: IMessageStorage) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<DbStatusResponse> {
    const dbPath = path.join(runtime.workspaceRoot, '.ai-team', 'private', 'ai-team.db');
    return dbStatusCommandAsync(this.storage, dbPath);
  }
}
