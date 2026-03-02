import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import { getGitUserName, getGitUserEmail, developerNameToId } from '@ai-team/service/dist/utils/git.js';

export function createDeveloperRouter(client: AiTeamClient, workspaceRoot: string): Router {
  const router = Router();

  /**
   * @openapi
   * /api/developer/me:
   *   get:
   *     tags: [Developer]
   *     summary: Get current developer profile
   *     description: Returns information about the current developer from git config
   *     responses:
   *       200:
   *         description: Developer profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                   example: clemens-meier
   *                 name:
   *                   type: string
   *                   example: Clemens Meier
   *                 email:
   *                   type: string
   *                   example: clemens.meier@example.com
   */
  router.get('/me', async (req: any, res: any, next: any) => {
    try {
      // Get developer info from git config
      const name = getGitUserName() || 'Developer';
      const email = getGitUserEmail();
      const id = developerNameToId(name);

      res.json({
        id,
        name,
        email: email || undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
