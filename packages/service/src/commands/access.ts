import path from 'node:path';
import { canReadPath, canWritePath, canListPath } from '@ai-team/infrastructure';
import type { Agent, AgentManager } from '@ai-team/infrastructure';
import type {
  FilePermission,
  DoIHavePermissionOptions,
  DoIHavePermissionResponse,
  WhoHasPermissionOptions,
  WhoHasPermissionResponse,
} from '@ai-team/api-client';
import { resolveAgentForOperationAsync } from '../utils/agent-resolution.js';

function resolvePathMeta(
  workspaceRoot: string,
  inputPath: string
): {
  insideWorkspace: boolean;
  absolute: string;
  relative: string;
} {
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspaceRoot, inputPath);

  const relative = path.relative(workspaceRoot, absolute).replaceAll('\\', '/');
  const insideWorkspace =
    relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  return {
    insideWorkspace,
    absolute,
    relative,
  };
}

function checkRight(
  workspaceRoot: string,
  agent: Agent,
  relativePath: string,
  right: FilePermission
): boolean {
  switch (right) {
    case 'read':
      return canReadPath(workspaceRoot, agent.permissions, relativePath);
    case 'write':
      return canWritePath(workspaceRoot, agent.permissions, relativePath);
    case 'list':
      return canListPath(workspaceRoot, agent.permissions, relativePath);
    default:
      return false;
  }
}

export async function whoHasAccessCommand(
  workspaceRoot: string,
  agentManager: AgentManager,
  options: WhoHasPermissionOptions
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

  const agents = await agentManager.getAllAgentsAsync();
  const matching = agents.filter((a: Agent) =>
    checkRight(workspaceRoot, a, pathMeta.relative, right)
  );
  const contextIds = matching.map((a: Agent) => a.id);
  const contexts = matching.map((a: Agent) => ({ contextId: a.id, label: a.name }));

  return {
    path: {
      input: options.path,
      absolute: pathMeta.absolute,
      relative: pathMeta.relative,
    },
    right,
    contextIds,
    contexts,
    explanation:
      contextIds.length > 0
        ? `${contextIds.length} agent(s) can access this path with '${right}'.`
        : `No agent can access this path with '${right}'.`,
  };
}

export async function doIHaveAccessCommand(
  workspaceRoot: string,
  agentManager: AgentManager,
  options: DoIHavePermissionOptions
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

  const agents = await agentManager.getAllAgentsAsync();

  let agent: Agent;
  let selectedBy: DoIHavePermissionResponse['selectedBy'];
  if (options.agent && options.agent.trim().length > 0) {
    const resolved = await resolveAgentForOperationAsync(
      agentManager,
      options.agent,
      'check access'
    );
    const found = await agentManager.getAgentAsync(resolved.id);
    if (!found) throw new Error(`Agent not found: ${resolved.id}`);
    agent = found;
    selectedBy = 'explicit';
  } else {
    const fallback = [...agents].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!fallback) throw new Error('No agents available to evaluate access.');
    agent = fallback;
    selectedBy = 'default-first-agent';
  }

  const allowed = checkRight(workspaceRoot, agent, pathMeta.relative, right);
  const allRights: FilePermission[] = [];
  if (checkRight(workspaceRoot, agent, pathMeta.relative, 'read')) allRights.push('read');
  if (checkRight(workspaceRoot, agent, pathMeta.relative, 'write')) allRights.push('write');
  if (checkRight(workspaceRoot, agent, pathMeta.relative, 'list')) allRights.push('list');

  return {
    path: {
      input: options.path,
      absolute: pathMeta.absolute,
      relative: pathMeta.relative,
    },
    right,
    contextId: agent.id,
    contextLabel: agent.name,
    selectedBy,
    allowed,
    allRights,
    explanation: allowed
      ? `Agent '${agent.id}' has ${right} access to '${pathMeta.relative}'.`
      : `Agent '${agent.id}' does not have ${right} access to '${pathMeta.relative}'.`,
    alternativeContexts: [],
    deniedByIgnore: false,
    blockedByPatterns: [],
  };
}
