import { describe, expect, it } from 'vitest';
import { ToolManager } from './tool-manager.js';
import { semanticSearchTool } from '../commands/edit/search-tools.js';
import { TOOL_SERVICE_TOKENS as T } from '@ai-team/core';

describe('ToolManager DI resolve wiring', () => {
  it('injects container.resolve into ToolContext for semantic search tool', async () => {
    const manager = new ToolManager('C:/workspace', {
      canReadPath: () => true,
      canWritePath: () => true,
      canListPath: () => true,
      assertCanReadPath: () => undefined,
      assertCanWritePath: () => undefined,
    });

    manager.register(semanticSearchTool as any);

    manager.setContainer({
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
    });

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
