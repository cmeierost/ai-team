import type { Router } from 'express';
import express from 'express';
import type { AiTeamClient } from '@ai-team/api-client';

const ToolsQuerySchema = {
  safeParse(query: unknown) {
    if (!query || typeof query !== 'object') {
      return { success: true as const, data: {} as { agent?: string } };
    }

    const rawAgent = (query as Record<string, unknown>).agent;
    if (rawAgent === undefined) {
      return { success: true as const, data: {} as { agent?: string } };
    }

    if (typeof rawAgent !== 'string') {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'agent must be a string when provided' }],
        },
      };
    }

    const agent = rawAgent.trim();
    if (!agent) {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'agent cannot be empty' }],
        },
      };
    }

    return {
      success: true as const,
      data: { agent },
    };
  },
};

const UpdateToolBodySchema = {
  safeParse(body: unknown) {
    if (!body || typeof body !== 'object') {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'request body must be an object' }],
        },
      };
    }

    const payload = body as Record<string, unknown>;
    const rawAgent = payload.agent;
    const rawTool = payload.tool;

    if (typeof rawAgent !== 'string' || rawAgent.trim().length === 0) {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'agent is required and must be a non-empty string' }],
        },
      };
    }

    if (typeof rawTool !== 'string' || rawTool.trim().length === 0) {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'tool is required and must be a non-empty string' }],
        },
      };
    }

    return {
      success: true as const,
      data: {
        agent: rawAgent.trim(),
        tool: rawTool.trim(),
      },
    };
  },
};

const GovernedUpdateToolBodySchema = {
  safeParse(body: unknown) {
    const base = UpdateToolBodySchema.safeParse(body);
    if (!base.success) {
      return base;
    }

    const payload = body as Record<string, unknown>;
    const requestedBy = payload.requestedBy;
    const approvedByUser = payload.approvedByUser;

    if (typeof requestedBy !== 'string' || requestedBy.trim().length === 0) {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'requestedBy is required and must be a non-empty string' }],
        },
      };
    }

    if (typeof approvedByUser !== 'boolean') {
      return {
        success: false as const,
        error: {
          issues: [{ message: 'approvedByUser is required and must be a boolean' }],
        },
      };
    }

    return {
      success: true as const,
      data: {
        ...base.data,
        requestedBy: requestedBy.trim(),
        approvedByUser,
      },
    };
  },
};

export function createToolsRouter(client: AiTeamClient): Router {
  const router = express.Router();
  const governedClient = client as AiTeamClient & {
    toolAllow: (options: { agent: string; tool: string }, governance: { requestedBy: string; approvedByUser: boolean }) => Promise<unknown>;
    toolDeny: (options: { agent: string; tool: string }, governance: { requestedBy: string; approvedByUser: boolean }) => Promise<unknown>;
  };

  /**
   * @openapi
   * /api/tools:
   *   get:
   *     tags: [Tools]
   *     summary: List registered tools
  *     description: Returns all registered tools; optional query parameter agent annotates allow/deny state for that agent.
   *     parameters:
   *       - name: agent
   *         in: query
   *         required: false
   *         schema:
   *           type: string
   *         description: Agent id, name, or role query for permission annotation
   *     responses:
   *       200:
   *         description: Tool catalog
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       400:
   *         description: Invalid query parameters
   */
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const parsed = ToolsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
      }

      const response = await client.listTools({
        agent: parsed.data.agent,
      });
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/tools/allow:
   *   post:
   *     tags: [Tools]
   *     summary: Allow a tool for an agent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [agent, tool]
   *             properties:
   *               agent:
   *                 type: string
   *               tool:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated agent tool permissions
   *       400:
   *         description: Invalid request body
   */
  router.post('/allow', async (req: any, res: any, next: any) => {
    try {
      const parsed = UpdateToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const response = await client.allowTool(parsed.data);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/tools/disallow:
   *   post:
   *     tags: [Tools]
   *     summary: Disallow a tool for an agent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [agent, tool]
   *             properties:
   *               agent:
   *                 type: string
   *               tool:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated agent tool permissions
   *       400:
   *         description: Invalid request body
   */
  router.post('/disallow', async (req: any, res: any, next: any) => {
    try {
      const parsed = UpdateToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const response = await client.disallowTool(parsed.data);
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tool_allow', async (req: any, res: any, next: any) => {
    try {
      const parsed = GovernedUpdateToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const response = await governedClient.toolAllow(
        { agent: parsed.data.agent, tool: parsed.data.tool },
        { requestedBy: parsed.data.requestedBy, approvedByUser: parsed.data.approvedByUser },
      );
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tool_deny', async (req: any, res: any, next: any) => {
    try {
      const parsed = GovernedUpdateToolBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.error.issues,
        });
      }

      const response = await governedClient.toolDeny(
        { agent: parsed.data.agent, tool: parsed.data.tool },
        { requestedBy: parsed.data.requestedBy, approvedByUser: parsed.data.approvedByUser },
      );
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
