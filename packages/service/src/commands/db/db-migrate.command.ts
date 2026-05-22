import type { ICommand, IMessageStorage, CommandResponse, ICommandDescriptor } from '@ai-team/core';
import type { DbMigrateResponse } from '@ai-team/api-contracts';
export const DbMigrateCommandMetadata = {
  key: 'migrate',
  description: 'Reset and initialize database schema (alpha)',
  availableIn: { cli: true },
  group: 'db',
} satisfies ICommandDescriptor;

export class DbMigrateCommand implements ICommand<Record<string, never>, DbMigrateResponse> {
  readonly metadata = DbMigrateCommandMetadata;

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
