import { z } from 'zod';
import { TOOL_SERVICE_TOKENS as T } from '@ai-team/core';
import type { Agent, IAgentManager, ExecutionContext, ICommand, CommandResponse } from '@ai-team/core';
import {
  accessRightSchema,
  type AccessRight,
  resolveFsAbsolutePath,
  toFsPathMeta,
} from './fs-access.js';

// ─── Helpers and interfaces ────────────────────────────────────────────────────

interface PathPermissionCheckerLike {
  canReadPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canWritePath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canListPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
}

type AgentManagerLike = IAgentManager & {
  analyzeWorkspacePermissionOverlap?: (options?: {
    mode?: 'files' | 'patterns';
    agentId?: string;
    maxDepth?: number;
  }) => Promise<unknown>;
};

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

function getContextDependencies(context: ExecutionContext): {
  checker: PathPermissionCheckerLike;
  agentManager: AgentManagerLike;
} {
  const checker = (context as any).pathPermissionChecker as PathPermissionCheckerLike | undefined;
  const agentManager = ((context as any).resolve?.(T.AgentManager)) as AgentManagerLike | undefined;
  if (!checker) {
    throw new Error(
      'ExecutionContext.pathPermissionChecker is required for access introspection tools.'
    );
  }
  if (!agentManager) {
    throw new Error(
      'ExecutionContext.resolve(AgentManager) is required for access introspection tools.'
    );
  }
  return { checker, agentManager };
}

// ─── WhoHasAccess ─────────────────────────────────────────────────────────────

export interface WhoHasAccessParams {
  path: string;
  right?: AccessRight;
}

export interface WhoHasAccessResult {
  path: { input: string; absolute: string; relative: string };
  right: AccessRight;
  contextIds: string[];
  contexts: Array<{ contextId: string; label: string | undefined }>;
  explanation: string;
}

export class WhoHasAccessTool  {
  readonly name = 'who_can';
  readonly key = 'who_can';
  readonly group = 'access';
  readonly availableIn = { tool: true };
  readonly description = 'Show which agents can access a path for a given right.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  });

  async execute(params: WhoHasAccessParams, context: ExecutionContext): Promise<WhoHasAccessResult> {
    const { path: targetPath, right = 'list' } = params;
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
  }
}

// ─── DoIHaveAccess ────────────────────────────────────────────────────────────

export interface DoIHaveAccessParams {
  path: string;
  right?: AccessRight;
  agentId?: string;
}

export interface DoIHaveAccessResult {
  path: { input: string; absolute: string; relative: string };
  right: AccessRight;
  contextId: string;
  contextLabel?: string;
  allowed: boolean;
  allRights: AccessRight[];
  explanation: string;
  alternativeContexts: never[];
}

export class DoIHaveAccessTool  {
  readonly name = 'can_i';
  readonly key = 'can_i';
  readonly group = 'access';
  readonly availableIn = { tool: true };
  readonly description =
    'Check whether the current agent (or an explicit agent) has access to a path/right.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z
      .string()
      .optional()
      .describe('Optional agent ID override (defaults to current agent)'),
  });

  async execute(params: DoIHaveAccessParams, context: ExecutionContext): Promise<DoIHaveAccessResult> {
    const { path: targetPath, right = 'list', agentId } = params;
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        right,
        contextId: agentId || context.agent!.id,
        allowed: false,
        allRights: [],
        explanation: 'Path is outside workspace root.',
        alternativeContexts: [],
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    const { checker, agentManager } = getContextDependencies(context);
    // Resolve agent — current or by ID
    let agent = context.agent!;
    if (agentId && agentId !== context.agent!.id) {
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
  }
}

// ─── AnalyzePermissionOverlap ─────────────────────────────────────────────────

export interface AnalyzePermissionOverlapParams {
  mode?: 'files' | 'patterns';
  agentId?: string;
  maxDepth?: number;
}

export class AnalyzePermissionOverlapTool {
  readonly name = 'analyze_permission_overlap';
  readonly key = 'analyze_permission_overlap';
  readonly group = 'access';
  readonly availableIn = { tool: true };
  readonly description =
    'Analyze workspace permission overlap by files or patterns, optionally focused on one agent.';
  readonly parameters = z.object({
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
  });

  async execute(params: AnalyzePermissionOverlapParams, context: ExecutionContext): Promise<unknown> {
    const { mode = 'files', agentId, maxDepth } = params;
    const { agentManager } = getContextDependencies(context);
    if (typeof agentManager.analyzeWorkspacePermissionOverlap !== 'function') {
      throw new Error(
        'ExecutionContext.resolve(AgentManager).analyzeWorkspacePermissionOverlap is required for overlap analysis.'
      );
    }
    return agentManager.analyzeWorkspacePermissionOverlap({ mode, agentId, maxDepth });
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

export const whoHasAccessTool = new WhoHasAccessTool();
export const doIHaveAccessTool = new DoIHaveAccessTool();
export const analyzePermissionOverlapTool = new AnalyzePermissionOverlapTool();
