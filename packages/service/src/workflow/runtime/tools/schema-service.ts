import type { ICommand, ICommandDescriptor, IToolManager, IToolSchemaService } from '@ai-team/core';
import { ZodSchemaTools } from '../../../utils/zod-schema.js';
import type { LlmToolDefinition } from '../../../tooling/manager/tool-manager.js';
import { ToolIdentity } from '../../../tooling/manager/tool-manager.js';

export class ToolSchemaService implements IToolSchemaService {
  private readonly schemaTools = new ZodSchemaTools();
  private readonly cache = new Map<string, LlmToolDefinition>();

  constructor(private readonly toolManager: IToolManager) {}

  getToolSchema(tool: ICommand): LlmToolDefinition {
    const key = ToolIdentity.key(tool.metadata);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const schema = this.toolManager.toSchema(key) ?? {
      name: key,
      description: tool.metadata.description,
      parameters: this.schemaTools.toJsonSchema(tool.metadata.parameters, {
        additionalProperties: true,
      }),
    };

    this.cache.set(key, schema);
    return schema;
  }

  buildToolDefinitions(tools: ICommand[]): LlmToolDefinition[] {
    return tools.map((tool) => this.getToolSchema(tool));
  }

  buildToolDefinitionsFromDescriptors(
    descriptors: Array<Pick<ICommandDescriptor, 'key' | 'group' | 'description'>>
  ): LlmToolDefinition[] {
    return descriptors.map((descriptor) => this.getToolSchemaFromDescriptor(descriptor));
  }

  private getToolSchemaFromDescriptor(
    descriptor: Pick<ICommandDescriptor, 'key' | 'group' | 'description'>
  ): LlmToolDefinition {
    const key = descriptor.group ? `${descriptor.group}_${descriptor.key}` : descriptor.key;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const schema = this.toolManager.toSchema(key) ?? {
      name: key,
      description: descriptor.description,
      parameters: this.schemaTools.toJsonSchema(undefined, {
        additionalProperties: true,
      }),
    };
    this.cache.set(key, schema);
    return schema;
  }
}
