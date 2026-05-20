import type { CliCommandMetadata } from '@ai-team/core';
import { createContainerWithBootstrap, TOKENS } from '@ai-team/container';
import type { IServiceContainer } from '@ai-team/core';
import {
  createCommandDispatcher,
  findWorkspaceRoot,
  IN_CHAT_COMMAND_ALIASES,
  IN_CHAT_COMMAND_REGISTRY,
  InteractionQuestionService,
} from '@ai-team/service';
import { createQuestionResponders } from '../handlers/question-responders.js';
export { IN_CHAT_COMMAND_ALIASES, IN_CHAT_COMMAND_REGISTRY };

const cliDispatchKeyByKey = new Map<string, string>();

interface ServiceCliEntry extends CliCommandMetadata {
  dispatchKey: string;
}

function firstWord(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value.trim();
}

function isArgToken(token: string | undefined): boolean {
  return Boolean(token && (token.startsWith('<') || token.startsWith('[')));
}

function normalizeCliRoute(
  command: string,
  parentKey?: string
): { command: string; parentKey?: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { command, parentKey };
  }

  if (parentKey) {
    return { command: trimmed, parentKey };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1 || isArgToken(parts[1])) {
    return { command: trimmed };
  }

  return {
    parentKey: parts[0],
    command: trimmed.slice(parts[0].length + 1),
  };
}

function deriveCliKey(command: string, parentKey?: string): string {
  const leaf = firstWord(command);
  return parentKey ? `${parentKey}.${leaf}` : leaf;
}

function loadServiceCliCommandRegistry(): CliCommandMetadata[] {
  const workspaceRoot = findWorkspaceRoot();
  const container = createContainerWithBootstrap({ workspaceRoot }, (c) => {
    c.registerInstance(
      TOKENS.QuestionService,
      InteractionQuestionService(createQuestionResponders())
    );
  });
  const dispatcher = createCommandDispatcher(
    workspaceRoot,
    container.child() as unknown as IServiceContainer
  );

  return dispatcher.getCommands({ cli: true }).map((command) => {
    const path = command.path?.filter(Boolean) ?? [];
    const leaf = path.length > 0 ? path[path.length - 1] : undefined;
    const usage = command.usage ?? command.key;
    const alignedUsage = leaf ? alignUsageToLeaf(usage, leaf) : usage;

    return {
      key: path.length > 0 ? path.join('.') : command.key,
      command: alignedUsage,
      parentKey: path.length > 1 ? path.slice(0, -1).join('.') : undefined,
      description: command.description,
      llmCallable: Boolean(command.availableIn.tool),
      directCli: true,
      aliases: command.aliases,
      options: undefined,
      hints: command.help?.hints,
      examples: command.help?.examples?.map((example) => example.value),
      jsonSignature: command.input?.jsonSignature,
    } as CliCommandMetadata;
  });
}

function alignUsageToLeaf(usage: string, leaf: string): string {
  const parts = usage.trim().split(/\s+/);
  const index = parts.findIndex((part) => part === leaf);
  if (index >= 0) {
    return parts.slice(index).join(' ');
  }
  return usage;
}

function buildCliCommandRegistry(): CliCommandMetadata[] {
  const serviceEntries = loadServiceCliCommandRegistry();

  const localCliOnlyEntries: ServiceCliEntry[] = [
    {
      key: 'serve',
      command: 'serve',
      description: 'Start API server (production mode)',
      llmCallable: false,
      directCli: true,
      options: [
        { flags: '--port <number>', description: 'API server port (default: 3002)' },
        { flags: '--workspace <path>', description: 'Workspace root override' },
      ],
      dispatchKey: '',
    },
    {
      key: 'serve.ui',
      parentKey: 'serve',
      command: 'ui',
      description: 'Start API server and launch UI',
      llmCallable: false,
      directCli: true,
      options: [
        { flags: '--port <number>', description: 'API server port (default: 3002)' },
        { flags: '--workspace <path>', description: 'Workspace root override' },
        { flags: '--ui-server-url <url>', description: 'API URL passed to UI launcher' },
      ],
      dispatchKey: '',
    },
    {
      key: 'ui',
      command: 'ui',
      description: 'Start UI dev server (starts API server if needed)',
      llmCallable: false,
      directCli: true,
      options: [
        { flags: '--workspace <path>', description: 'Workspace root override' },
        { flags: '--server-url <url>', description: 'Explicit API base URL for the UI' },
        { flags: '--include-api', description: 'Force-start API server alongside UI' },
      ],
      dispatchKey: '',
    },
  ];

  cliDispatchKeyByKey.clear();

  const merged = new Map<string, ServiceCliEntry>();
  const orderedKeys: string[] = [];

  const upsert = (entry: ServiceCliEntry): void => {
    if (!merged.has(entry.key)) {
      orderedKeys.push(entry.key);
      merged.set(entry.key, entry);
      return;
    }

    const existing = merged.get(entry.key)!;
    merged.set(entry.key, {
      ...existing,
      ...entry,
      aliases: existing.aliases ?? entry.aliases,
      options: existing.options ?? entry.options,
      arguments: existing.arguments ?? entry.arguments,
      hints: existing.hints ?? entry.hints,
      examples: existing.examples ?? entry.examples,
      jsonSignature: existing.jsonSignature ?? entry.jsonSignature,
    });
  };

  for (const raw of serviceEntries) {
    const normalized = normalizeCliRoute(raw.command, raw.parentKey);
    const key = deriveCliKey(normalized.command, normalized.parentKey);

    upsert({
      ...raw,
      key,
      command: normalized.command,
      parentKey: normalized.parentKey,
      directCli: true,
      dispatchKey: raw.key,
    });
  }

  for (const localEntry of localCliOnlyEntries) {
    upsert(localEntry);
  }

  const ensureSyntheticParent = (parentKey: string): void => {
    if (merged.has(parentKey)) {
      return;
    }

    const parts = parentKey.split('.');
    const command = parts[parts.length - 1];
    const parentOfParent = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;

    if (parentOfParent) {
      ensureSyntheticParent(parentOfParent);
    }

    upsert({
      key: parentKey,
      command,
      parentKey: parentOfParent,
      description: `${command} commands`,
      llmCallable: false,
      directCli: true,
      dispatchKey: '',
    });
  };

  for (const entry of [...merged.values()]) {
    if (entry.parentKey) {
      ensureSyntheticParent(entry.parentKey);
    }
  }

  for (const key of orderedKeys) {
    const dispatchKey = merged.get(key)?.dispatchKey;
    if (dispatchKey) {
      cliDispatchKeyByKey.set(key, dispatchKey);
    }
  }

  return orderedKeys
    .map((key) => merged.get(key))
    .filter((entry): entry is ServiceCliEntry => Boolean(entry))
    .map(({ dispatchKey: _dispatchKey, ...entry }) => entry);
}

export const CLI_COMMAND_REGISTRY: CliCommandMetadata[] = buildCliCommandRegistry();

export function getLlmCallableCliCommands(): CliCommandMetadata[] {
  return CLI_COMMAND_REGISTRY.filter((entry) => entry.llmCallable);
}

export function getCliCommandMetadata(key: string): CliCommandMetadata {
  const match = CLI_COMMAND_REGISTRY.find((entry) => entry.key === key);
  if (!match) {
    throw new Error(`Command metadata not found for key '${key}'.`);
  }
  return match;
}

export function getCliDispatchCommandKey(key: string): string {
  return cliDispatchKeyByKey.get(key) ?? key;
}
