import type { Router } from 'express';
import express from 'express';
import type { AiTeamClient } from '@ai-team/api-client';

function parseSearchQuery(query: unknown): { ok: true; data: { q?: string; agent?: string } } | { ok: false; issues: Array<{ message: string }> } {
  if (!query || typeof query !== 'object') {
    return { ok: true, data: {} };
  }

  const source = query as Record<string, unknown>;
  const data: { q?: string; agent?: string } = {};

  if (source.q !== undefined) {
    if (typeof source.q !== 'string' || source.q.trim().length === 0) {
      return { ok: false, issues: [{ message: 'q must be a non-empty string when provided' }] };
    }
    data.q = source.q.trim();
  }

  if (source.agent !== undefined) {
    if (typeof source.agent !== 'string' || source.agent.trim().length === 0) {
      return { ok: false, issues: [{ message: 'agent must be a non-empty string when provided' }] };
    }
    data.agent = source.agent.trim();
  }

  return { ok: true, data };
}

function parseMutationBody(body: unknown): { ok: true; data: { agent: string; skill: string } } | { ok: false; issues: Array<{ message: string }> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, issues: [{ message: 'Body must be an object' }] };
  }

  const source = body as Record<string, unknown>;
  const agent = typeof source.agent === 'string' ? source.agent.trim() : '';
  const skill = typeof source.skill === 'string' ? source.skill.trim() : '';

  if (!agent || !skill) {
    return { ok: false, issues: [{ message: 'Both agent and skill are required' }] };
  }

  return { ok: true, data: { agent, skill } };
}

export function createSkillsRouter(client: AiTeamClient): Router {
  const router = express.Router();

  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const parsed = parseSearchQuery(req.query);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: parsed.issues,
        });
      }

      const response = await client.searchSkills({
        query: parsed.data.q,
        agent: parsed.data.agent,
      });
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post('/add', async (req: any, res: any, next: any) => {
    try {
      const parsed = parseMutationBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.issues,
        });
      }

      const result = await client.addSkill(parsed.data);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/remove', async (req: any, res: any, next: any) => {
    try {
      const parsed = parseMutationBody(req.body);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: parsed.issues,
        });
      }

      const result = await client.removeSkill(parsed.data);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
