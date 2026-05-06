import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/storage/sqlite/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: './.ai-team/private/ai-team.db',
  },
  strict: true,
  verbose: true,
});
