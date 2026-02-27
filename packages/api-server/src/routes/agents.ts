import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';

export function createAgentsRouter(client: AiTeamClient): Router {
  const router = express.Router();

  // GET /api/agents - List all agents
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.listEmployees({});
      res.json(agents);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/agents/:id - Get specific agent
  router.get('/:id', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.resolveEmployees(req.params.id);
      if (agents.length === 0) {
        return res.status(404).json({
          error: 'Agent not found',
          details: `Agent with ID ${req.params.id} does not exist`,
        });
      }
      res.json(agents[0]);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
