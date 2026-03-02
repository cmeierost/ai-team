import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';

export function createTeamRouter(client: AiTeamClient): Router {
  const router = express.Router();

  /**
   * @openapi
   * /api/team/graph:
   *   get:
   *     tags: [Team]
   *     summary: Get team hierarchy graph
   *     description: Returns the team structure as a graph with nodes (agents) and edges (relationships)
   *     parameters:
   *       - in: query
   *         name: mode
   *         schema:
   *           type: string
   *           enum: [hierarchy, collaboration, full]
   *           default: hierarchy
   *         description: Graph mode - hierarchy (org structure), collaboration (work relationships), or full (both)
   *     responses:
   *       200:
   *         description: Team graph data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 nodes:
   *                   type: array
   *                   items:
   *                     type: object
   *                 edges:
   *                   type: array
   *                   items:
   *                     type: object
   */
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
