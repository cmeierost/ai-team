import path from 'node:path';
import { AgentManager, createPermissionEngine, loadTeamConfig } from '@ai-team/core';
import type {
  FilePermission,
  DoIHavePermissionOptions,
  DoIHavePermissionResponse,
  WhoHasPermissionOptions,
  WhoHasPermissionResponse,
} from '../contracts.js';
import { resolveAgentForOperation } from '../utils/agent-resolution.js';

function resolvePathMeta(workspaceRoot: string, inputPath: string): {
  insideWorkspace: boolean;
  absolute: string;
  relative: string;
} {
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspaceRoot, inputPath);

  const relative = path.relative(workspaceRoot, absolute).replaceAll('\\', '/');
  const insideWorkspace = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  return {
    insideWorkspace,
    absolute,
    relative,
  };
}

async function buildPermissionEngine(workspaceRoot: string) {
  const [config, agentManager] = await Promise.all([
    loadTeamConfig(workspaceRoot),
    (async () => {
      const manager = new AgentManager(workspaceRoot);
      await manager.initialize();
      return manager;
    })(),
  ]);

  const agents = agentManager.getAllAgents();
  const engine = createPermissionEngine({
    workspaceRoot,
    fileTreeConfig: config?.fileTree,
    agents,
  });

  return {
    engine,
    agentManager,
    agents,
  };
}

export async function whoHasAccessCommand(
  workspaceRoot: string,
  options: WhoHasPermissionOptions,
): Promise<WhoHasPermissionResponse> {
  const right: FilePermission = options.right ?? 'list';
  const pathMeta = resolvePathMeta(workspaceRoot, options.path);

  if (!pathMeta.insideWorkspace) {
    return {
      path: {
        input: options.path,
        absolute: pathMeta.absolute,
        relative: pathMeta.relative,
      },
      right,
      contextIds: [],
      contexts: [],
      explanation: 'Path is outside workspace root.',
    };
  }

  const { engine } = await buildPermissionEngine(workspaceRoot);
  const contextIds = engine.whoCanAccess(options.path, right, workspaceRoot);
  const contexts = contextIds.map((contextId) => ({
    contextId,
    label: engine.getContext(contextId)?.label,
  }));

  return {
    path: {
      input: options.path,
      absolute: pathMeta.absolute,
      relative: pathMeta.relative,
    },
    right,
    contextIds,
    contexts,
    explanation: contextIds.length > 0
      ? `${contextIds.length} context(s) can access this path with '${right}'.`
      : `No context can access this path with '${right}'.`,
  };
}

export async function doIHaveAccessCommand(
  workspaceRoot: string,
  options: DoIHavePermissionOptions,
): Promise<DoIHavePermissionResponse> {
  const right: FilePermission = options.right ?? 'list';
  const pathMeta = resolvePathMeta(workspaceRoot, options.path);

  if (!pathMeta.insideWorkspace) {
    return {
      path: {
        input: options.path,
        absolute: pathMeta.absolute,
        relative: pathMeta.relative,
      },
      right,
      contextId: options.agent ?? 'unknown',
      selectedBy: options.agent ? 'explicit' : 'default-first-agent',
      allowed: false,
      allRights: [],
      explanation: 'Path is outside workspace root.',
      alternativeContexts: [],
      deniedByIgnore: false,
      blockedByPatterns: [],
    };
  }

  const { engine, agentManager, agents } = await buildPermissionEngine(workspaceRoot);

  let contextId = '';
  let selectedBy: DoIHavePermissionResponse['selectedBy'];
  if (options.agent && options.agent.trim().length > 0) {
    contextId = resolveAgentForOperation(agentManager, options.agent, 'check access').id;
    selectedBy = 'explicit';
  } else {
    const fallback = [...agents].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!fallback) {
      throw new Error('No agents available to evaluate access.');
    }
    contextId = fallback.id;
    selectedBy = 'default-first-agent';
  }

  const verdict = engine.checkPath(options.path, right, workspaceRoot, contextId);
  const allRightsMap = engine.whatCanContextDo(contextId, [options.path], workspaceRoot);
  const allRights = [...(allRightsMap.get(pathMeta.relative) ?? new Set<FilePermission>())];

  return {
    path: {
      input: options.path,
      absolute: pathMeta.absolute,
      relative: pathMeta.relative,
    },
    right,
    contextId,
    contextLabel: engine.getContext(contextId)?.label,
    selectedBy,
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
}
