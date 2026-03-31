import express, { Request, Response } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import type { FilePermission } from '@ai-team/service';

const FILE_PERMISSIONS = new Set<FilePermission>(['read', 'write', 'create', 'delete', 'list']);
const OVERLAP_MODES = new Set(['files', 'patterns']);

function normalizeSingleQueryParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseFilePermission(value: string | undefined): FilePermission | undefined {
  if (!value) {
    return undefined;
  }

  if (!FILE_PERMISSIONS.has(value as FilePermission)) {
    throw new Error('"right" must be one of "read", "write", "create", "delete", or "list"');
  }

  return value as FilePermission;
}

function parseMaxDepth(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('"maxDepth" must be a non-negative integer');
  }

  return parsed;
}

/**
 * @openapi
 * tags:
 *   - name: Access
 *     description: Access introspection and permission overlap analysis
 */
export function createAccessRouter(client: AiTeamClient): express.Router {
  const router = express.Router();

  router.get('/who', async (req: Request, res: Response) => {
    try {
      const targetPath = normalizeSingleQueryParam(req.query.path as string | string[] | undefined);
      if (!targetPath) {
        return res.status(400).json({ error: '"path" query parameter is required' });
      }

      const right = parseFilePermission(normalizeSingleQueryParam(req.query.right as string | string[] | undefined));
      const response = await client.whoHasPermission({
        path: targetPath,
        ...(right ? { right } : {}),
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('"')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/can', async (req: Request, res: Response) => {
    try {
      const targetPath = normalizeSingleQueryParam(req.query.path as string | string[] | undefined);
      if (!targetPath) {
        return res.status(400).json({ error: '"path" query parameter is required' });
      }

      const right = parseFilePermission(normalizeSingleQueryParam(req.query.right as string | string[] | undefined));
      const agent = normalizeSingleQueryParam(req.query.agent as string | string[] | undefined);
      const response = await client.doIHavePermission({
        path: targetPath,
        ...(right ? { right } : {}),
        ...(agent ? { agent } : {}),
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('"')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  router.get('/overlap', async (req: Request, res: Response) => {
    try {
      const mode = normalizeSingleQueryParam(req.query.mode as string | string[] | undefined);
      if (mode && !OVERLAP_MODES.has(mode)) {
        return res.status(400).json({ error: '"mode" must be one of "files" or "patterns"' });
      }

      const agent = normalizeSingleQueryParam(req.query.agent as string | string[] | undefined);
      const maxDepth = parseMaxDepth(normalizeSingleQueryParam(req.query.maxDepth as string | string[] | undefined));

      const response = await client.analyzePermissionOverlap({
        ...(mode ? { mode: mode as 'files' | 'patterns' } : {}),
        ...(agent ? { agentId: agent } : {}),
        ...(maxDepth !== undefined ? { maxDepth } : {}),
      });

      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('"')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  return router;
}
