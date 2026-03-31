import { z } from 'zod';
import { analyzeWorkspacePermissionOverlap } from '../context/perm-overlap.js';
import type { AgentTool } from '../types/index.js';
import {
  accessRightSchema,
  type AccessRight,
  getPermissionEngineOrDeny,
  resolveFsAbsolutePath,
  toFsPathMeta,
} from './fs-access.js';

export const whoHasAccessTool: AgentTool = {
  name: 'who_can',
  group: 'access',
  description: 'Show which contexts/agents can access a path for a given right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  }),
  async execute(params, context) {
    const engineCheck = getPermissionEngineOrDeny(context);
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
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        right,
        contextIds: [],
        contexts: [],
        explanation: engineCheck.reason,
      };
    }

    const contextIds = context.permissionEngine!.whoCanAccess(targetPath, right, context.workspaceRoot);
    const contexts = contextIds.map((contextId) => ({
      contextId,
      label: context.permissionEngine!.getContext(contextId)?.label,
    }));

    return {
      path: pathMeta,
      right,
      contextIds,
      contexts,
      explanation: contextIds.length > 0
        ? `${contextIds.length} context(s) can access this path with '${right}'.`
        : `No context can access this path with '${right}'.`,
    };
  },
};

export const doIHaveAccessTool: AgentTool = {
  name: 'can_i',
  group: 'access',
  description: 'Check whether the current context (or an explicit context) has access to a path/right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z.string().optional().describe('Optional context/agent ID override (defaults to current agent)'),
  }),
  async execute(params, context) {
    const engineCheck = getPermissionEngineOrDeny(context);
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
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        right,
        contextId: agentId || context.agent.id,
        allowed: false,
        allRights: [],
        explanation: engineCheck.reason,
      };
    }

    const targetContextId = agentId || context.agent.id;
    const allRightsMap = context.permissionEngine!.whatCanContextDo(targetContextId, [targetPath], context.workspaceRoot);
    const allRights = [...(allRightsMap.get(pathMeta.relative) ?? new Set<AccessRight>())];
    const verdict = context.permissionEngine!.checkPath(targetPath, right, context.workspaceRoot, targetContextId);

    return {
      path: pathMeta,
      right,
      contextId: targetContextId,
      contextLabel: context.permissionEngine!.getContext(targetContextId)?.label,
      allowed: verdict.allowed,
      allRights,
      explanation: verdict.explanation,
      alternativeContexts: verdict.alternativeContexts,
      deniedByIgnore: verdict.paths.some((pv) => pv.deniedByIgnore === true),
      blockedByPatterns: Array.from(new Set(
        verdict.paths
          .filter((pv) => !pv.allowed && pv.deniedBy?.pathPattern)
          .map((pv) => pv.deniedBy!.pathPattern),
      )),
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
    const engineCheck = getPermissionEngineOrDeny(context);
    if (!engineCheck.ok) {
      throw new Error(engineCheck.reason);
    }

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
