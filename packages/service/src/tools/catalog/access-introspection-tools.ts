import { z } from 'zod';
import type { AgentTool, Agent, ToolContext } from '@ai-team/core';
import {
  accessRightSchema,
  type AccessRight,
  resolveFsAbsolutePath,
  toFsPathMeta,
} from './fs-access.js';

interface PathPermissionCheckerLike {
  canReadPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canWritePath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canListPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
}

interface AgentManagerLike {
  getAllAgentsAsync(): Promise<Array<{ id: string; name: string; permissions: unknown }>>;
  getAgentAsync(
    id: string
  ): Promise<{ id: string; name: string; permissions: unknown } | undefined>;
}

function checkRightWithChecker(
  workspaceRoot: string,
  checker: PathPermissionCheckerLike,
  agent: Agent,
  relativePath: string,
  right: AccessRight
): boolean {
  switch (right) {
    case 'read':
      return checker.canReadPath(workspaceRoot, agent.permissions, relativePath);
    case 'write':
      return checker.canWritePath(workspaceRoot, agent.permissions, relativePath);
    case 'list':
      return checker.canListPath(workspaceRoot, agent.permissions, relativePath);
  }
}

function getContextDependencies(context: ToolContext): {
  checker: PathPermissionCheckerLike;
  agentManager: AgentManagerLike;
} {
  const checker = (context as any).pathPermissionChecker as PathPermissionCheckerLike | undefined;
  const agentManager = (context as any).agentManager as AgentManagerLike | undefined;
  if (!checker) {
    throw new Error(
      'ToolContext.pathPermissionChecker is required for access introspection tools.'
    );
  }
  if (!agentManager) {
    throw new Error('ToolContext.agentManager is required for access introspection tools.');
  }
  return { checker, agentManager };
}

export const whoHasAccessTool: AgentTool = {
  name: 'who_can',
  group: 'access',
  description: 'Show which agents can access a path for a given right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  }),
  async execute(params, context) {
    const { path: targetPath, right = 'list' } = params as { path: string; right?: AccessRight };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        right,
        contextIds: [],
        contexts: [],
        explanation: 'Path is outside workspace root.',
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    const { checker, agentManager } = getContextDependencies(context);
    const agents = await agentManager.getAllAgentsAsync();

    const matching = agents.filter((a: any) =>
      checkRightWithChecker(context.workspaceRoot, checker, a as Agent, pathMeta.relative, right)
    );
    const contextIds = matching.map((a: any) => a.id);
    const contexts = matching.map((a: any) => ({ contextId: a.id, label: a.name }));

    return {
      path: pathMeta,
      right,
      contextIds,
      contexts,
      explanation:
        contextIds.length > 0
          ? `${contextIds.length} agent(s) can access this path with '${right}'.`
          : `No agent can access this path with '${right}'.`,
    };
  },
};

export const doIHaveAccessTool: AgentTool = {
  name: 'can_i',
  group: 'access',
  description: 'Check whether the current agent (or an explicit agent) has access to a path/right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z
      .string()
      .optional()
      .describe('Optional agent ID override (defaults to current agent)'),
  }),
  async execute(params, context) {
    const {
      path: targetPath,
      right = 'list',
      agentId,
    } = params as { path: string; right?: AccessRight; agentId?: string };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        right,
        contextId: agentId || context.agent.id,
        allowed: false,
        allRights: [],
        explanation: 'Path is outside workspace root.',
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    const { checker, agentManager } = getContextDependencies(context);
    // Resolve agent — current or by ID
    let agent = context.agent;
    if (agentId && agentId !== context.agent.id) {
      const found = await agentManager.getAgentAsync(agentId);
      if (found) {
        agent = found as Agent;
      }
    }

    const allowed = checkRightWithChecker(
      context.workspaceRoot,
      checker,
      agent,
      pathMeta.relative,
      right
    );
    const allRights: AccessRight[] = [];
    if (checker.canReadPath(context.workspaceRoot, agent.permissions, pathMeta.relative))
      allRights.push('read');
    if (checker.canWritePath(context.workspaceRoot, agent.permissions, pathMeta.relative))
      allRights.push('write');
    if (checker.canListPath(context.workspaceRoot, agent.permissions, pathMeta.relative))
      allRights.push('list');

    return {
      path: pathMeta,
      right,
      contextId: agent.id,
      contextLabel: agent.name,
      allowed,
      allRights,
      explanation: allowed
        ? `Agent '${agent.id}' has ${right} access to '${pathMeta.relative}'.`
        : `Agent '${agent.id}' does not have ${right} access to '${pathMeta.relative}'.`,
      alternativeContexts: [],
    };
  },
};

export const analyzePermissionOverlapTool: AgentTool = {
  name: 'analyze_permission_overlap',
  group: 'access',
  description:
    'Analyze workspace permission overlap by files or patterns, optionally focused on one agent.',
  parameters: z.object({
    mode: z.enum(['files', 'patterns']).optional().describe('Analysis mode (default: files)'),
    agentId: z
      .string()
      .optional()
      .describe('Optional exact agent id for focused overlap reporting'),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Optional max workspace traversal depth for file mode'),
  }),
  async execute(params, context) {
    const {
      mode = 'files',
      agentId,
      maxDepth,
    } = params as {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    };
    return analyzeWorkspacePermissionOverlap(context.workspaceRoot, {
      mode,
      agentId,
      maxDepth,
    });
  },
};

async function analyzeWorkspacePermissionOverlap(
  workspaceRoot: string,
  options: { mode?: string; agentId?: string; maxDepth?: number }
) {
  const { analyzeWorkspacePermissionOverlap: fn } = await import('@ai-team/infrastructure');
  return fn(workspaceRoot, options as never);
}
