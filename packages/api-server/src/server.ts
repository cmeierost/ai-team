import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { join, resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger-auto.js';
import { generateAsyncApiSpec } from './asyncapi.js';
import { createLocalAiTeamClient } from '@ai-team/api-client';
import { AgentManager } from '@ai-team/core';
import { SessionManager, createSqliteStorage, findWorkspaceRoot, getSystemInfo } from '@ai-team/service';
import { createAgentsRouter } from './routes/agents.js';
import { createTeamRouter } from './routes/team.js';
import { createChatRouter } from './routes/chat.js';
import { createSessionsRouter, createArtifactsRouter } from './routes/sessions.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createDeveloperRouter } from './routes/developer.js';
import { createFileTreeRouter } from './routes/file-tree.js';
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
  const workspaceRoot = options.workspaceRoot || process.env.AI_TEAM_WORKSPACE || findWorkspaceRoot();
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

  // Create AgentManager for fuzzy agent resolution
  const agentManager = new AgentManager(workspaceRoot);
  try {
    await agentManager.loadAllAgents();
  } catch (error) {
    console.warn('Failed to load agents:', error);
  }

  // Create SessionManager for WebSocket message persistence
  const storage = createSqliteStorage(workspaceRoot);
  const sessionManager = new SessionManager(workspaceRoot, storage, agentManager);
  await sessionManager.initialize();

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API Routes
  app.use('/api/agents', createAgentsRouter(client, agentManager));
  app.use('/api/team', createTeamRouter(client));
  app.use('/api/chat', createChatRouter(client, workspaceRoot, agentManager, sessionManager));
  app.use('/api/sessions', createSessionsRouter(workspaceRoot, agentManager, sessionManager));
  app.use('/api/artifacts', createArtifactsRouter(workspaceRoot, sessionManager));
  app.use('/api/tasks', createTaskRoutes(workspaceRoot, agentManager));
  app.use('/api/developer', createDeveloperRouter(client, workspaceRoot));
  app.use('/api/files', createFileTreeRouter(workspaceRoot));

  // System info endpoint
  /**
   * @openapi
   * /api/info:
   *   get:
   *     tags: [System]
   *     summary: Get system information
   *     description: Returns information about the API server and workspace
   *     responses:
   *       200:
   *         description: System information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 apiUrl:
   *                   type: string
   *                   description: API base URL
   *                 workspace:
   *                   type: string
   *                   description: Workspace root path
   *                 branch:
   *                   type: string
   *                   description: Current git branch
   *                 package:
   *                   type: object
   *                   properties:
   *                     name:
   *                       type: string
   *                     version:
   *                       type: string
   *                     description:
   *                       type: string
   */
  app.get('/api/info', (req, res) => {
    try {
      const apiUrl = `${req.protocol}://${req.get('host')}`;
      const systemInfo = getSystemInfo(workspaceRoot);

      res.json({
        apiUrl,
        ...systemInfo
      });
    } catch (error) {
      console.error('Error getting system info:', error);
      res.status(500).json({ 
        error: 'Failed to get system info',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Health check
  /**
   * @openapi
   * /api/health:
   *   get:
   *     tags: [Health]
   *     summary: Health check endpoint
   *     description: Returns the health status of the API server
   *     responses:
   *       200:
   *         description: Server is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 workspace:
   *                   type: string
   *                   description: Workspace root path
   */
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', workspace: workspaceRoot });
  });

  // Swagger API documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'AI Team API Documentation',
  }));

  // Swagger JSON spec endpoint
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // AsyncAPI WebSocket documentation
  const asyncApiSpec = generateAsyncApiSpec();
  
  app.get('/asyncapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(asyncApiSpec);
  });

  app.get('/asyncapi', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI Team WebSocket API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@1.4.10/styles/default.min.css">
  <style>
    body { margin: 0; padding: 0; }
    #asyncapi { height: 100vh; overflow: auto; }
  </style>
</head>
<body>
  <div id="asyncapi"></div>
  <script src="https://unpkg.com/@asyncapi/react-component@1.4.10/browser/standalone/index.js"></script>
  <script>
    AsyncApiStandalone.render({
      schema: {
        url: '/asyncapi.json'
      },
      config: {
        show: {
          sidebar: true
        }
      }
    }, document.getElementById('asyncapi'));
  </script>
</body>
</html>
    `);
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

    // Extract agent ID from URL path: /ws/chat/:agentId?sessionId=xxx
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const agentId = pathParts && pathParts.length >= 3 ? pathParts[2] : '';
    const sessionId = url.searchParams.get('sessionId');

    if (!agentId) {
      ws.send(JSON.stringify({ type: 'error', data: { error: 'Agent ID is required' } }));
      ws.close();
      return;
    }

    console.log(`WebSocket connected: agent=${agentId}, session=${sessionId || 'none'}`);
    setupChatWebSocket(ws, agentId, client, sessionManager, sessionId, agentManager);
  });

  // Start server
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.log(`✓ Server listening on http://localhost:${port}`);
      console.log(`✓ API available at http://localhost:${port}/api`);
      console.log(`✓ API Documentation available at http://localhost:${port}/api-docs`);
      console.log(`✓ WebSocket Documentation available at http://localhost:${port}/asyncapi`);
      console.log(`✓ WebSocket available at ws://localhost:${port}/ws/chat/:agentId`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    wss.close();
    await storage.close();
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, httpServer, wss, storage };
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
