import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';

export function createTeamRouter(client: AiTeamClient): Router {
  const router = express.Router();

  // GET /api/team/graph - Get team hierarchy graph
  router.get('/graph', async (req: any, res: any, next: any) => {
    try {
      const mode = (req.query.mode as string) || 'hierarchy';
      const graphData = await client.getTeamGraph(mode as any);
      res.json(graphData);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
