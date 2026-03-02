/**
 * Auto-generated Swagger/OpenAPI specification using swagger-jsdoc.
 * Parses JSDoc comments from route files to generate the spec.
 * 
 * To document an endpoint, add JSDoc comments above the route handler:
 * 
 * @example
 * ```typescript
 * /**
 *  * @openapi
 *  * /api/agents:
 *  *   get:
 *  *     tags: [Agents]
 *  *     summary: List all agents
 *  *     responses:
 *  *       200:
 *  *         description: List of agents
 *  * /
 * router.get('/', async (req, res) => { ... });
 * ```
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI Team API',
      version: '0.1.0',
      description: 'HTTP REST API server for AI Team web UI - enabling team member management, chat sessions, task tracking, and workflows.',
      contact: {
        name: 'AI Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:3002',
        description: 'Development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Health check endpoints' },
      { name: 'Developer', description: 'Developer profile and identity' },
      { name: 'Agents', description: 'Team member/agent management' },
      { name: 'Team', description: 'Team hierarchy and relationships' },
      { name: 'Chat', description: 'Chat history and messaging' },
      { name: 'Sessions', description: 'Session management' },
      { name: 'Artifacts', description: 'Session artifacts (files, code, etc.)' },
      { name: 'Tasks', description: 'Task and workflow management' },
    ],
  },
  // Parse JSDoc comments from route files
  apis: [
    join(__dirname, 'routes', '*.ts'),
    join(__dirname, 'routes', '*.js'),
    join(__dirname, 'server.ts'),
    join(__dirname, 'server.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
