import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createContainerWithBootstrap, TOKENS } from '@ai-team/container';
import { findWorkspaceRoot, WsQuestionService, EmitService } from '@ai-team/service';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service/src/types.js';
import { SqliteBackend } from '@ai-team/infrastructure';
import { createExpressRouter } from '@ts-http/express';
import {
  systemDesc,
  agentsDesc,
  teamDesc,
  chatDesc,
  sessionsDesc,
  artifactsDesc,
  tasksDesc,
  planningDesc,
  developerDesc,
  permissionDesc,
  ideDesc,
  skillsDesc,
  toolsDesc,
  configDesc,
  contextDesc,
  commandsDesc,
  accessDesc,
} from '@ai-team/api-contracts';

import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { setupChatWebSocket } from './ws/chat-handler.js';
import { asyncApiUi as serveApiDefinition } from './async-api-ui.js';
import { serveStaticFiles } from './serve-static-files.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  port?: number;
  workspaceRoot?: string;
  serveStaticFiles?: boolean;
}

export async function startServer(options: ServerOptions = {}): Promise<any> {
  const port = options.port ?? Number.parseInt(process.env.PORT || '3002', 10);
  const workspaceRoot =
    options.workspaceRoot || process.env.AI_TEAM_WORKSPACE || findWorkspaceRoot();

  console.log(`Starting AI Team API Server...`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Port: ${port}`);

  // Verify workspace has .ai-team directory
  const aiTeamDir = join(workspaceRoot, '.ai-team');
  if (!existsSync(aiTeamDir)) {
    console.warn(`Warning: .ai-team directory not found at ${aiTeamDir}`);
    console.warn(`Make sure to run 'ait init' in your workspace first.`);
  }

  const backend = new SqliteBackend(workspaceRoot);
  await backend.migrate();

  const apiBaseUrl = `http://localhost:${port}`;

  const container = createContainerWithBootstrap(
    {
      workspaceRoot,
      apiBaseUrl,
    },
    (c) => {
      // Provide the pre-migrated backend so the container doesn't re-create it.
      c.registerInstance(TOKENS.SqliteBackend, backend);
      // Provide the actual API base URL for SystemService.
      c.registerInstance(TOKENS.ApiBaseUrl, apiBaseUrl);
    }
  );

  const agentManager = container.resolve(TOKENS.AgentManager);
  const sessionManager = container.resolve(TOKENS.SessionManager);

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  // Wire each namespace: description + service instance → Express router
  app.use(
    systemDesc.subRoute!,
    createExpressRouter(systemDesc, container.resolve(TOKENS.SystemService))
  );
  app.use(
    agentsDesc.subRoute!,
    createExpressRouter(agentsDesc, container.resolve(TOKENS.AgentsService))
  );
  app.use(teamDesc.subRoute!, createExpressRouter(teamDesc, container.resolve(TOKENS.TeamService)));
  app.use(chatDesc.subRoute!, createExpressRouter(chatDesc, container.resolve(TOKENS.ChatService)));
  app.use(
    sessionsDesc.subRoute!,
    createExpressRouter(sessionsDesc, container.resolve(TOKENS.SessionsService))
  );
  app.use(
    artifactsDesc.subRoute!,
    createExpressRouter(artifactsDesc, container.resolve(TOKENS.ArtifactsService))
  );
  app.use(
    tasksDesc.subRoute!,
    createExpressRouter(tasksDesc, container.resolve(TOKENS.TasksService))
  );
  app.use(
    planningDesc.subRoute!,
    createExpressRouter(planningDesc, container.resolve(TOKENS.PlanningService))
  );
  app.use(
    developerDesc.subRoute!,
    createExpressRouter(developerDesc, container.resolve(TOKENS.DeveloperService))
  );
  app.use(
    permissionDesc.subRoute!,
    createExpressRouter(permissionDesc, container.resolve(TOKENS.FilesService))
  );
  app.use(ideDesc.subRoute!, createExpressRouter(ideDesc, container.resolve(TOKENS.IdeService)));
  app.use(
    skillsDesc.subRoute!,
    createExpressRouter(skillsDesc, container.resolve(TOKENS.SkillsService))
  );
  app.use(
    toolsDesc.subRoute!,
    createExpressRouter(toolsDesc, container.resolve(TOKENS.ToolsService))
  );
  app.use(
    configDesc.subRoute!,
    createExpressRouter(configDesc, container.resolve(TOKENS.ConfigService))
  );
  app.use(
    contextDesc.subRoute!,
    createExpressRouter(contextDesc, container.resolve(TOKENS.MetaService))
  );
  app.use(
    commandsDesc.subRoute!,
    createExpressRouter(commandsDesc, container.resolve(TOKENS.CommandsService))
  );
  app.use(
    accessDesc.subRoute!,
    createExpressRouter(accessDesc, container.resolve(TOKENS.AccessService))
  );

  // AsyncAPI WebSocket documentation
  serveApiDefinition(app);

  serveStaticFiles(options, app, workspaceRoot);

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

    const connectionContainer = container.child();
    const questionService = new WsQuestionService();
    questionService.setup((data) => ws.send(JSON.stringify({ type: 'question', data })));
    connectionContainer.registerInstance(TOKENS.QuestionService, questionService);

    // Per-connection EmitService. Default sink is the connection-level WebSocket;
    // InteractionStream temporarily rebinds the sink per request so it can
    // correlate events with the current requestId and emit terminal state.
    const emitService = new EmitService((event) => {
      ws.send(JSON.stringify({ type: 'runtime', data: event }));
    });
    connectionContainer.registerInstance(TOKENS.EmitService, emitService);
    connectionContainer.registerInstance(COMMAND_FACTORY_TOKENS.EmitService, emitService);

    const interactionService = connectionContainer.resolve(TOKENS.InteractionService);

    setupChatWebSocket(ws, agentId, interactionService, sessionManager, sessionId, {
      agentManager,
      workspaceRoot,
      llmService: container.resolve(TOKENS.LlmService),
      questionService,
    });
  });

  // Start server
  await new Promise<void>((resolve) => {
    httpServer.listen(port, '::', () => {
      const addr = httpServer.address() as { port: number } | null;
      const actualPort = addr?.port ?? port;
      console.log(`✓ Server listening on http://localhost:${actualPort}`);
      console.log(`✓ API available at http://localhost:${actualPort}/api`);
      console.log(`✓ API Documentation available at http://localhost:${actualPort}/api-docs`);
      console.log(`✓ WebSocket Documentation available at http://localhost:${actualPort}/asyncapi`);
      console.log(`✓ WebSocket available at ws://localhost:${actualPort}/ws/chat/:agentId`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down server...');
    wss.close();
    await backend.close();
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, httpServer, wss, storage: backend };
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await startServer();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
