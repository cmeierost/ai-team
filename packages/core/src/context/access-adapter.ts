/**
 * Bridge between AI Team agent/config types and @ai-team/access.
 *
 * Converts Agent/FileTreeConfig into AccessContext/AccessRule,
 * and provides a factory to create a fully wired AccessEngine.
 */

import {
  AccessEngine,
  type AccessContext,
  type AccessRule,
} from '@ai-team/access';
import type { Agent, FileTreeConfig } from '../types/index.js';
import { registerBuiltInToolDescriptors, registerCommonCommandDescriptors } from '../tools/tool-descriptors.js';

/** Well-known context ID for workspace-level global permissions. */
export const GLOBAL_CONTEXT_ID = '__global__';

/**
 * Convert an Agent's permissions into an AccessContext.
 *
 * In AI Team, write implies read. The adapter preserves this by
 * adding read rules for every write pattern that isn't already covered.
 */
export function agentToAccessContext(agent: Agent): AccessContext {
  const rules: AccessRule[] = [];

  return {
    id: agent.id,
    label: agent.name,
    rules,
    metadata: {
      contextLevel: agent.contextLevel,
      manage_agents: agent.contextLevel === 'organization',
    },
  };
}

/**
 * Convert FileTreeConfig (global workspace permissions) into a global AccessContext.
 */
export function fileTreeConfigToAccessContext(config: FileTreeConfig): AccessContext {
  const rules: AccessRule[] = [];
  const readPaths = config.readPaths ?? [];
  const writePaths = config.writePaths ?? [];
  const createPaths = config.createPaths ?? [];
  const deletePaths = config.deletePaths ?? [];
  const listSet = new Set<string>();

  for (const pattern of readPaths) {
    rules.push({ right: 'read', effect: 'allow', pathPattern: pattern });
    if (!listSet.has(pattern)) {
      rules.push({ right: 'list', effect: 'allow', pathPattern: pattern });
      listSet.add(pattern);
    }
  }

  const readSet = new Set(readPaths);
  for (const pattern of writePaths) {
    rules.push({ right: 'write', effect: 'allow', pathPattern: pattern });
    if (!readSet.has(pattern)) {
      rules.push({ right: 'read', effect: 'allow', pathPattern: pattern });
      if (!listSet.has(pattern)) {
        rules.push({ right: 'list', effect: 'allow', pathPattern: pattern });
        listSet.add(pattern);
      }
    }
  }

  for (const pattern of createPaths) {
    rules.push({ right: 'create', effect: 'allow', pathPattern: pattern });
  }

  for (const pattern of deletePaths) {
    rules.push({ right: 'delete', effect: 'allow', pathPattern: pattern });
  }

  return {
    id: GLOBAL_CONTEXT_ID,
    label: 'Global workspace permissions',
    rules,
  };
}

export interface CreateAccessEngineOptions {
  workspaceRoot: string;
  fileTreeConfig?: FileTreeConfig;
  agents?: Agent[];
  defaultCommandPolicy?: 'deny' | 'allow';
  defaultToolPolicy?: 'deny' | 'allow';
}

/**
 * Factory: create a fully wired AccessEngine from AI Team config data.
 *
 * Registers global context from FileTreeConfig, one context per agent,
 * and all built-in tool + command descriptors.
 */
export function createAccessEngine(options: CreateAccessEngineOptions): AccessEngine {
  const engine = new AccessEngine({
    workspaceRoot: options.workspaceRoot,
    defaultCommandPolicy: options.defaultCommandPolicy ?? 'deny',
    defaultToolPolicy: options.defaultToolPolicy ?? 'deny',
  });

  // Global context from FileTreeConfig
  if (options.fileTreeConfig) {
    const globalCtx = fileTreeConfigToAccessContext(options.fileTreeConfig);
    engine.registerContext(globalCtx);
    engine.setGlobalContext(globalCtx.id);
  }

  // Per-agent contexts
  for (const agent of options.agents ?? []) {
    engine.registerContext(agentToAccessContext(agent));
  }

  // Register built-in tool and command descriptors
  registerBuiltInToolDescriptors(engine);
  registerCommonCommandDescriptors(engine);

  return engine;
}
