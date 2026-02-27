import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createLocalAiTeamClient } from '@ai-team/api-client';
import { createAgentsRouter } from './routes/agents.js';
import { createTeamRouter } from './routes/team.js';
import { createChatRouter } from './routes/chat.js';
import { createSessionsRouter, createArtifactsRouter } from './routes/sessions.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { setupChatWebSocket } from './ws/chat-handler.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  port?: number;
  workspaceRoot?: string;
  serveStaticFiles?: boolean;
}

export async function startServer(options: ServerOptions = {}): Promise<any> {
  const port = options.port || parseInt(process.env.PORT || '3002', 10);
  const workspaceRoot = options.workspaceRoot || process.env.AI_TEAM_WORKSPACE || process.cwd();
  const serveStaticFiles = options.serveStaticFiles ?? process.env.NODE_ENV === 'production';

  console.log(`Starting AI Team API Server...`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Port: ${port}`);

  // Verify workspace has .ai-team directory
  const aiTeamDir = join(workspaceRoot, '.ai-team');
  if (!existsSync(aiTeamDir)) {
    console.warn(`Warning: .ai-team directory not found at ${aiTeamDir}`);
    console.warn(`Make sure to run 'ait init' in your workspace first.`);
  }

  // Create API client
  const client = createLocalAiTeamClient(workspaceRoot);

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API Routes
  app.use('/api/agents', createAgentsRouter(client));
  app.use('/api/team', createTeamRouter(client));
  app.use('/api/chat', createChatRouter(client, workspaceRoot));
  app.use('/api/sessions', createSessionsRouter(workspaceRoot));
  app.use('/api/artifacts', createArtifactsRouter(workspaceRoot));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', workspace: workspaceRoot });
  });

  // Serve avatars directory as static files
  const avatarsPath = join(workspaceRoot, '.ai-team', 'avatars');
  if (existsSync(avatarsPath)) {
    app.use('/avatars', express.static(avatarsPath));
    console.log(`Serving avatars from: ${avatarsPath}`);
  }

  // Serve static files from web build (production mode)
  if (serveStaticFiles) {
    const webDistPath = resolve(join(__dirname, '..', '..', 'web', 'dist'));
    if (existsSync(webDistPath)) {
      console.log(`Serving static files from: ${webDistPath}`);
      app.use(express.static(webDistPath));
      
      // SPA fallback - serve index.html for all non-API routes
      app.get('*', (req, res, next) => {
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

  // Error handlers (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Create HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server (without path restriction to allow /ws/chat/:agentId)
  const wss = new WebSocketServer({ 
    server: httpServer,
    noServer: false,
  });

  wss.on('connection', (ws, req) => {
    // Check if this is a chat WebSocket connection
    if (!req.url?.startsWith('/ws/chat/')) {
      ws.send(JSON.stringify({ type: 'error', data: { error: 'Invalid WebSocket path' } }));
      ws.close();
      return;
    }

    // Extract agent ID from URL path: /ws/chat/:agentId
    const pathParts = req.url.split('/').filter(Boolean);
    const agentId = pathParts && pathParts.length >= 3 ? pathParts[2] : '';

    if (!agentId) {
      ws.send(JSON.stringify({ type: 'error', data: { error: 'Agent ID is required' } }));
      ws.close();
      return;
    }

    console.log(`WebSocket connected: agent=${agentId}`);
    setupChatWebSocket(ws, agentId, client);
  });

  // Start server
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.log(`✓ Server listening on http://localhost:${port}`);
      console.log(`✓ API available at http://localhost:${port}/api`);
      console.log(`✓ WebSocket available at ws://localhost:${port}/ws/chat/:agentId`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    wss.close();
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, httpServer, wss };
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
