import type {
  ChatMessage,
  ExecutionContext,
  ICommand,
  ICommandRegistry,
  IServiceContainer,
  IFileAnnotationService,
} from '@ai-team/core';
import type { IContextCompressor, IMcpGateway, IRagProvider } from '../runtime/pipeline.js';
import { ToolIdentity } from '../../tooling/manager/tool-manager.js';

const DEFAULT_CONTEXT_MESSAGE_LIMIT = 120;

/**
 * Keeps recent conversation turns while still performing an explicit compression step.
 * This avoids relying on an empty no-op implementation.
 */
export class RecentTurnsContextCompressor implements IContextCompressor {
  constructor(private readonly maxMessages: number = DEFAULT_CONTEXT_MESSAGE_LIMIT) {}

  async compress(history: ChatMessage[], _ctx: ExecutionContext): Promise<ChatMessage[]> {
    if (history.length <= this.maxMessages) {
      return history;
    }
    return history.slice(-this.maxMessages);
  }
}

/**
 * Provides lightweight retrieval hints from files readable by the current agent.
 * Returned text nudges the model to use file tools for deeper reads.
 */
export class SearchHintRagProvider implements IRagProvider {
  constructor(
    private readonly workspaceRoot: string,
    private readonly fileAnnotationService: IFileAnnotationService,
    private readonly maxHints: number = 8
  ) {}

  async retrieve(query: string, ctx: ExecutionContext): Promise<string | null> {
    const trimmed = query.trim();
    if (!trimmed || !ctx.agent?.permissions) {
      return null;
    }

    const tokens = tokenizeQuery(trimmed);
    if (tokens.length === 0) {
      return null;
    }

    const annotated = this.fileAnnotationService.getAnnotatedFiles(
      this.workspaceRoot,
      ctx.agent.permissions,
      []
    );

    const matched = annotated
      .filter((entry) => entry.readable)
      .map((entry) => {
        const lowerPath = entry.path.toLowerCase();
        const score = tokens.reduce((acc, token) => (lowerPath.includes(token) ? acc + 1 : acc), 0);
        return { path: entry.path, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, this.maxHints);

    if (matched.length === 0) {
      return null;
    }

    return [
      'Potentially relevant readable files:',
      ...matched.map((entry) => `- ${entry.path}`),
      'Use file/search tools to inspect exact contents before acting.',
    ].join('\n');
  }
}

/**
 * Discovers external MCP tools from the command registry instead of hardcoding
 * an empty gateway implementation.
 */
export class RegistryMcpGateway implements IMcpGateway {
  constructor(
    private readonly registry: ICommandRegistry,
    private readonly container: IServiceContainer
  ) {}

  async discover(): Promise<ICommand[]> {
    const descriptors = this.registry.getAll({ availableIn: { tool: true } }).filter((meta) => {
      const key = meta.key.toLowerCase();
      const group = (meta.group ?? '').toLowerCase();
      const tags = (meta.tags ?? []).map((tag) => tag.toLowerCase());
      return key.startsWith('mcp_') || group === 'mcp' || tags.includes('mcp');
    });

    const uniqueByKey = new Map<string, ICommand>();
    for (const descriptor of descriptors) {
      const canonicalKey = ToolIdentity.key(descriptor);
      const command = this.registry.resolve(canonicalKey, this.container);
      if (command) {
        uniqueByKey.set(canonicalKey, command);
      }
    }

    return [...uniqueByKey.values()];
  }
}

function tokenizeQuery(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/g)
        .filter((token) => token.length >= 3)
    ),
  ];
}
