import type { ICommand, IMessageStorage, CommandResponse } from '@ai-team/core';
import type { DbMigrateResponse } from '@ai-team/api-contracts';

export class DbMigrateCommand implements ICommand<Record<string, never>, DbMigrateResponse> {
  readonly key = 'dbMigrate';
  readonly cli = { command: 'db:migrate' };
  readonly description = 'Reset and initialize database schema (alpha)';
  readonly availableIn = { cli: true };
  readonly group = 'db';

  constructor(private readonly storage: IMessageStorage) {}

  async execute(): Promise<CommandResponse<DbMigrateResponse>> {
    try {
      const applied = await this.storage.resetAndInitializeAsync();
      const stats = await this.storage.getStats();
      return {
        status: 'ok',
        message: 'Database migration completed successfully.',
        data: {
          applied: applied ?? 0,
          schemaVersion: stats.schemaVersion ?? 0,
        },
      };
    } catch (err) {
      return {
        status: 'error',
        message: `Database migration failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
