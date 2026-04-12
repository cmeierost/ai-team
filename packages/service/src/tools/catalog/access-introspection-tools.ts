import { z } from 'zod';
import { analyzeWorkspacePermissionOverlap } from '@ai-team/infrastructure';
import { canListPath, canReadPath, canWritePath, AgentManager } from '@ai-team/infrastructure';
import type { AgentTool, Agent } from '@ai-team/core';
import {
  accessRightSchema,
  type AccessRight,
  resolveFsAbsolutePath,
  toFsPathMeta,
} from './fs-access.js';

/** Resolve right check for a single agent+path via permission helpers. */
function checkRight(workspaceRoot: string, agent: Agent, relativePath: string, right: AccessRight): boolean {
  switch (right) {
    case 'read': return canReadPath(workspaceRoot, agent.permissions, relativePath);
    case 'write': return canWritePath(workspaceRoot, agent.permissions, relativePath);
    case 'list': return canListPath(workspaceRoot, agent.permissions, relativePath);
  }
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
    const agentManager = new AgentManager(context.workspaceRoot);
    const agents = await agentManager.getAllAgentsAsync();

    const matching = agents.filter((a) => checkRight(context.workspaceRoot, a, pathMeta.relative, right));
    const contextIds = matching.map((a) => a.id);
    const contexts = matching.map((a) => ({ contextId: a.id, label: a.name }));

    return {
      path: pathMeta,
      right,
      contextIds,
      contexts,
      explanation: contextIds.length > 0
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
    agentId: z.string().optional().describe('Optional agent ID override (defaults to current agent)'),
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
    // Resolve agent — current or by ID
    let agent = context.agent;
    if (agentId && agentId !== context.agent.id) {
      const agentManager = new AgentManager(context.workspaceRoot);
      const found = await agentManager.getAgentAsync(agentId);
      if (found) {
        agent = found;
      }
    }

    const allowed = checkRight(context.workspaceRoot, agent, pathMeta.relative, right);
    const allRights: AccessRight[] = [];
    if (canReadPath(context.workspaceRoot, agent.permissions, pathMeta.relative)) allRights.push('read');
    if (canWritePath(context.workspaceRoot, agent.permissions, pathMeta.relative)) allRights.push('write');
    if (canListPath(context.workspaceRoot, agent.permissions, pathMeta.relative)) allRights.push('list');

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
  description: 'Analyze workspace permission overlap by files or patterns, optionally focused on one agent.',
  parameters: z.object({
    mode: z.enum(['files', 'patterns']).optional().describe('Analysis mode (default: files)'),
    agentId: z.string().optional().describe('Optional exact agent id for focused overlap reporting'),
    maxDepth: z.number().int().min(0).optional().describe('Optional max workspace traversal depth for file mode'),
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
