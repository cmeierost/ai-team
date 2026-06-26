import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  cacheDir: resolve(__dirname, '../../.vite/viewer-app'),
  server: { port: 4173 },
  resolve: {
    alias: {
      '@aspect/viewer': resolve(__dirname, '../viewer/src/index.ts'),
    },
  },
});
