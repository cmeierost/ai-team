import type { ICommand } from '@ai-team/core';
import { ZodSchemaTools } from '../../utils/zod-schema.js';
import type { LlmToolDefinition } from '../../tools/tool-manager.js';
import { ToolIdentity } from '../../tools/tool-manager.js';
import type { ToolManager } from '../../tools/tool-manager.js';

export class ToolSchemaService {
  private readonly schemaTools = new ZodSchemaTools();
  private readonly cache = new Map<string, LlmToolDefinition>();

  constructor(private readonly toolManager: ToolManager) {}

  getToolSchema(tool: ICommand): LlmToolDefinition {
    const key = ToolIdentity.key(tool);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const schema = this.toolManager.toSchema(key) ?? {
      name: key,
      description: tool.description,
      parameters: this.schemaTools.toJsonSchema(tool.parameters, {
        additionalProperties: true,
      }),
    };

    this.cache.set(key, schema);
    return schema;
  }

  buildToolDefinitions(tools: ICommand[]): LlmToolDefinition[] {
    return tools.map((tool) => this.getToolSchema(tool));
  }
}
