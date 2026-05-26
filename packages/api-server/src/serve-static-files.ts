import express from 'express';
import { existsSync } from 'node:fs';
import { ServerOptions } from './server.js';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = fileURLToPath(new URL('.', import.meta.url));

export function serveStaticFiles(
  options: ServerOptions,
  app: express.Express,
  workspaceRoot: string
) {
  const avatarsPath = join(workspaceRoot, '.ai-team', 'avatars');
  if (existsSync(avatarsPath)) {
    app.use('/avatars', express.static(avatarsPath));
    console.log(`Serving avatars from: ${avatarsPath}`);
  }

  const serveStaticFiles = options.serveStaticFiles ?? process.env.NODE_ENV === 'production';

  // Serve static files from web build (production mode)
  if (serveStaticFiles) {
    const webDistPath = resolve(join(moduleDir, '..', '..', 'web', 'dist'));
    if (existsSync(webDistPath)) {
      console.log(`Serving static files from: ${webDistPath}`);
      // Exclude /api and /ws paths from static serving
      app.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
          return next();
        }
        express.static(webDistPath)(req, res, next);
      });

      // SPA fallback - serve index.html for all non-API routes
      // Express 5 / path-to-regexp v8 requires named wildcards.
      app.get('/{*splat}', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
          return next();
        }
        res.sendFile(join(webDistPath, 'index.html'));
      });
    } else {
      console.warn(`Web dist directory not found at ${webDistPath}`);
      console.warn(`Run 'pnpm --filter @ai-team/web build' to build the web UI.`);
    }
  }
}
