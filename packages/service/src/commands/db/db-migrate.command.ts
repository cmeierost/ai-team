import type { ICommand, CommandRuntime, IMessageStorage } from '@ai-team/core';
import type { DbMigrateResponse } from '@ai-team/api-contracts';
import { dbMigrateCommandAsync } from './db.js';

export class DbMigrateCommand implements ICommand<Record<string, never>, void, DbMigrateResponse> {
  readonly key = 'dbMigrate';
  readonly cli = { command: 'db:migrate' };
  readonly description = 'Reset and initialize database schema (alpha)';
  readonly availableIn = { cli: true };
  readonly group = 'db';

  constructor(private readonly storage: IMessageStorage) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<DbMigrateResponse> {
    return dbMigrateCommandAsync(this.storage);
  }
}
