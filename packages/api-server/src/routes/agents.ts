import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';

/**
 * @openapi
 * components:
 *   schemas:
 *     Agent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         role:
 *           type: string
 *         providerId:
 *           type: string
 *         modelId:
 *           type: string
 */

export function createAgentsRouter(client: AiTeamClient): Router {
  const router = express.Router();

  /**
   * @openapi
   * /api/agents:
   *   get:
   *     tags: [Agents]
   *     summary: List all agents
   *     description: Retrieve a list of all team members/agents
   *     responses:
   *       200:
   *         description: List of agents
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Agent'
   */
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const agents = await client.listEmployees({});
      res.json(agents);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/search:
   *   get:
   *     tags: [Agents]
   *     summary: Get a specific agent
   *     description: Retrieve details of a specific team member/agent by ID
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Agent details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Agent'
   *       404:
   *         description: Agent not found
   */
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

  /**
   * @openapi
   * /api/agents/search:
   *   get:
   *     tags: [Agents]
   *     summary: Search agents
   *     description: Search for agents with fuzzy matching and filtering
   *     parameters:
   *       - name: q
   *         in: query
   *         schema:
   *           type: string
   *         description: Search query (name, role, specializations, features, etc.)
   *       - name: role
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by role (can be repeated)
   *       - name: type
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by role type (executive, team-lead, etc.)
   *       - name: status
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by status (available, busy, etc.)
   *       - name: feature
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by feature (can be repeated)
   *       - name: specialization
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by specialization (can be repeated)
   *       - name: tool
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by tool (can be repeated)
   *       - name: reportsTo
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by manager ID
   *       - name: contextLevel
   *         in: query
   *         schema:
   *           type: string
   *         description: Filter by context level (task, module, feature, repository, organization)
   *     responses:
   *       200:
   *         description: Search results with scores
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       agent:
   *                         $ref: '#/components/schemas/Agent'
   *                       score:
   *                         type: number
   *                       matches:
   *                         type: array
   *                         items:
   *                           type: string
   *                 totalCount:
   *                   type: number
   */
  router.get('/search', async (req: any, res: any, next: any) => {
    try {
      // Parse query parameters (support arrays)
      const parseArrayParam = (param: any): string[] | undefined => {
        if (!param) return undefined;
        return Array.isArray(param) ? param : [param];
      };

      const searchRequest: any = {
        query: req.query.q,
        role: parseArrayParam(req.query.role),
        type: parseArrayParam(req.query.type),
        status: parseArrayParam(req.query.status),
        feature: parseArrayParam(req.query.feature),
        specialization: parseArrayParam(req.query.specialization),
        tool: parseArrayParam(req.query.tool),
        reportsTo: req.query.reportsTo,
        contextLevel: parseArrayParam(req.query.contextLevel),
      };

      // Remove undefined values
      Object.keys(searchRequest).forEach(key => {
        if (searchRequest[key] === undefined) {
          delete searchRequest[key];
        }
      });

      const response = await client.searchAgents(searchRequest);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/agents/{id}:
   *   get:
   *     tags: [Agents]
   *     summary: Get a specific agent
   *     description: Retrieve details of a specific team member/agent by ID
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Agent details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Agent'
   *       404:
   *         description: Agent not found
   */
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
