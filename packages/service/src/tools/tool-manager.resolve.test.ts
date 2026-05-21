import { describe, expect, it } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { TOOL_SERVICE_TOKENS as T } from '@ai-team/core';
import { z } from 'zod';
import { CommandRegistry } from '../command-registry-impl.js';

describe('ToolManager DI resolve wiring', () => {
  it('injects container.resolve into ToolContext for semantic search tool', async () => {
    const registry = new CommandRegistry();

    const container = {
      resolve(token: unknown) {
        if (token === T.FileAnnotationService) {
          return {
            getAnnotatedFiles: () => [
              { path: 'src/a.ts', readable: true, writable: false, listable: true },
              { path: 'docs/readme.md', readable: true, writable: false, listable: true },
            ],
          };
        }
        throw new Error(`Unexpected token: ${String((token as any)?.id ?? token)}`);
      },
    };

    const manager = new ToolManager(
      'C:/workspace',
      {
        canReadPath: () => true,
        canWritePath: () => true,
        canListPath: () => true,
        assertCanReadPath: () => undefined,
        assertCanWritePath: () => undefined,
      },
      registry,
      container
    );

    const semanticMeta = {
      key: 'semantic',
      group: 'search',
      availableIn: { tool: true, cli: false, chat: false },
      description: 'test semantic search',
      parameters: z.object({ query: z.string() }),
    };
    registry.register(semanticMeta, () => ({
      metadata: semanticMeta,
      async execute(params: { query: string }, context: any) {
        const svc = context.resolve(T.FileAnnotationService);
        const results = svc.getAnnotatedFiles().filter((f: any) => f.path.includes(params.query));
        return { results };
      },
    }));

    const result = await manager.execute(
      {
        id: 'agent-1',
        name: 'Agent One',
        role: 'developer',
        tools: ['search_semantic'],
        disallowedTools: [],
        permissions: {},
        contextLevel: 'standard',
      } as any,
      'search_semantic',
      { query: 'src' },
      {
        workspaceRoot: 'C:/workspace',
      } as any
    );

    expect(result.ok).toBe(true);
    expect((result.result as any).results).toEqual([
      {
        path: 'src/a.ts',
        readable: true,
        writable: false,
        listable: true,
      },
    ]);
  });
});
