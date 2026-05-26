/**
 * Zod schema helpers.
 * Zod v4 exposes toJSONSchema() on schema objects.
 */
export class ZodSchemaTools {
  toJsonSchema(
    schema: unknown,
    options?: { additionalProperties?: boolean }
  ): Record<string, unknown> {
    if (
      schema &&
      typeof schema === 'object' &&
      typeof (schema as any).toJSONSchema === 'function'
    ) {
      return (schema as any).toJSONSchema() as Record<string, unknown>;
    }

    const fallback: Record<string, unknown> = { type: 'object', properties: {} };
    if (options && 'additionalProperties' in options) {
      fallback.additionalProperties = options.additionalProperties;
    }
    return fallback;
  }
}
