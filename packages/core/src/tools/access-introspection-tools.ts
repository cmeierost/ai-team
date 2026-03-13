import { z } from 'zod';
import type { AgentTool } from '../types/index.js';
import {
  accessRightSchema,
  type AccessRight,
  getAccessEngineOrDeny,
  resolveFsAbsolutePath,
  toFsPathMeta,
} from './fs-access.js';

export const whoHasAccessTool: AgentTool = {
  name: 'fs_who_can',
  description: 'Show which contexts/agents can access a path for a given right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  }),
  async execute(params, context) {
    const engineCheck = getAccessEngineOrDeny(context);
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

    const contextIds = context.accessEngine!.whoCanAccess(targetPath, right, context.workspaceRoot);
    const contexts = contextIds.map((contextId) => ({
      contextId,
      label: context.accessEngine!.getContext(contextId)?.label,
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
  name: 'tool_can_i',
  description: 'Check whether the current context (or an explicit context) has access to a path/right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z.string().optional().describe('Optional context/agent ID override (defaults to current agent)'),
  }),
  async execute(params, context) {
    const engineCheck = getAccessEngineOrDeny(context);
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
    const allRightsMap = context.accessEngine!.whatCanContextDo(targetContextId, [targetPath], context.workspaceRoot);
    const allRights = [...(allRightsMap.get(pathMeta.relative) ?? new Set<AccessRight>())];
    const verdict = context.accessEngine!.checkPath(targetPath, right, context.workspaceRoot, targetContextId);

    return {
      path: pathMeta,
      right,
      contextId: targetContextId,
      contextLabel: context.accessEngine!.getContext(targetContextId)?.label,
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
