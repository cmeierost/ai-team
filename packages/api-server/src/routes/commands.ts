import { Router } from 'express';
import { IN_CHAT_COMMAND_REGISTRY } from '@ai-team/service';

export function createCommandsRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/commands:
   *   get:
   *     tags: [Commands]
   *     summary: List available slash commands
   *     description: Returns the registry of in-chat slash commands available to users
   *     responses:
   *       200:
   *         description: Array of slash command descriptors
   */
  router.get('/', (_req, res, next) => {
    try {
      res.json(IN_CHAT_COMMAND_REGISTRY);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
