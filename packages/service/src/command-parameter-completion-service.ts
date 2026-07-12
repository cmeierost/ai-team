import type { ExecutionContext, IServiceContainer, ICommandDescriptor } from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from './types.js';
import { getPathValue, setPathValue } from './command-adapters.js';
import type { IQuestionService } from './questions/question-service.js';
import { ZodSchemaTools } from './utils/zod-schema.js';

type RequiredFieldMetadata = {
  path: string;
  description?: string;
  enumValues?: string[];
  jsonType?: string;
};

/**
 * Completes missing required command parameters by asking the user interactively.
 *
 * This is intentionally surface-agnostic and can be reused by slash + CLI dispatch
 * flows before final command argument resolution/validation.
 */
export class CommandParameterCompletionService {
  private readonly schemaTools = new ZodSchemaTools();

  constructor(private readonly resolver: IServiceContainer) {}

  async complete(
    descriptor: ICommandDescriptor,
    payload: unknown,
    ctx: ExecutionContext
  ): Promise<unknown> {
    if (ctx.invocationSurface === 'tool' || !descriptor.parameters) {
      return payload;
    }

    const questionService = this.resolver.tryResolve(COMMAND_FACTORY_TOKENS.QuestionService) as
      | IQuestionService
      | undefined;

    if (!questionService) {
      return payload;
    }

    const schema = this.schemaTools.toJsonSchema(descriptor.parameters);
    const requiredFields = this.collectMissingRequiredFields(schema, payload);
    if (requiredFields.length === 0) {
      return payload;
    }

    const base = this.toMutablePayload(payload);
    for (const field of requiredFields) {
      if (getPathValue(base, field.path) !== undefined) {
        continue;
      }

      const answered = await this.promptForFieldValue(questionService, descriptor.key, field);
      setPathValue(base, field.path, answered);
    }

    return base;
  }

  private collectMissingRequiredFields(schema: unknown, payload: unknown): RequiredFieldMetadata[] {
    const required = this.collectRequiredFieldMetadata(schema);
    return required.filter(({ path }) => getPathValue(payload, path) === undefined);
  }

  private collectRequiredFieldMetadata(schema: unknown, parentPath = ''): RequiredFieldMetadata[] {
    if (!schema || typeof schema !== 'object') {
      return [];
    }

    const schemaRecord = schema as Record<string, unknown>;
    const required = Array.isArray(schemaRecord.required)
      ? (schemaRecord.required as string[])
      : [];
    const properties =
      schemaRecord.properties && typeof schemaRecord.properties === 'object'
        ? (schemaRecord.properties as Record<string, unknown>)
        : {};

    const collected: RequiredFieldMetadata[] = [];

    for (const key of required) {
      const propSchema = properties[key];
      const path = parentPath ? `${parentPath}.${key}` : key;

      if (propSchema && typeof propSchema === 'object') {
        const propRecord = propSchema as Record<string, unknown>;
        const propType = typeof propRecord.type === 'string' ? propRecord.type : undefined;
        const nested = this.collectRequiredFieldMetadata(propSchema, path);

        if (nested.length > 0 && propType === 'object') {
          collected.push(...nested);
          continue;
        }

        const enumValues = Array.isArray(propRecord.enum)
          ? (propRecord.enum as unknown[])
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined;

        collected.push({
          path,
          description:
            typeof propRecord.description === 'string' ? propRecord.description : undefined,
          enumValues: enumValues && enumValues.length > 0 ? enumValues : undefined,
          jsonType: propType,
        });

        continue;
      }

      collected.push({ path });
    }

    return collected;
  }

  private async promptForFieldValue(
    questionService: IQuestionService,
    commandKey: string,
    field: RequiredFieldMetadata
  ): Promise<unknown> {
    const fieldLabel = `'${field.path}'`;
    const descriptionSuffix = field.description ? ` — ${field.description}` : '';

    if (field.jsonType === 'boolean') {
      return questionService.confirm({
        message: `Provide value for /${commandKey} ${fieldLabel}${descriptionSuffix}`,
      });
    }

    if (field.enumValues && field.enumValues.length > 0) {
      return questionService.select({
        message: `Select value for /${commandKey} ${fieldLabel}${descriptionSuffix}`,
        choices: field.enumValues.map((value) => ({ name: value, value })),
      });
    }

    const value = await questionService.input({
      message: `Enter value for /${commandKey} ${fieldLabel}${descriptionSuffix}`,
      validate: (input) => input.trim().length > 0 || `${field.path} is required`,
    });

    if (field.jsonType === 'number' || field.jsonType === 'integer') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }

    return value;
  }

  private toMutablePayload(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return { ...(payload as Record<string, unknown>) };
    }
    return {};
  }
}
