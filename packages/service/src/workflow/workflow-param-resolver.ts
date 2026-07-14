import type { z } from 'zod';
import type { ILlmService } from '@ai-team/core';
import type { IQuestionService } from '../interaction/question-service.js';
import type {
  WorkflowArgValue,
  WorkflowCoalesceTransform,
  WorkflowLiteralTransform,
  WorkflowMapTransform,
} from './workflow-types.js';

export function resolveTemplateExpressions(
  args: Record<string, WorkflowArgValue>,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, expr] of Object.entries(args)) {
    resolved[key] = resolveTemplateData(expr, state, index, locals);
  }

  return resolved;
}

export function resolveTemplateData(
  value: unknown,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): unknown {
  const primitive = resolvePrimitiveValue(value, state, index, locals);
  if (primitive.resolved) return primitive.value;

  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateData(entry, state, index, locals));
  }

  if (value && typeof value === 'object') {
    const transformed = resolveTransformValue(value, state, index, locals);
    if (transformed.handled) return transformed.value;

    const resolvedObject: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      resolvedObject[entryKey] = resolveTemplateData(entryValue, state, index, locals);
    }
    return resolvedObject;
  }

  return value;
}

function resolvePrimitiveValue(
  value: unknown,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): { resolved: boolean; value: unknown } {
  if (typeof value === 'string') {
    return { resolved: true, value: evaluateExpression(value, state, index, locals) };
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return { resolved: true, value };
  }

  return { resolved: false, value };
}

function resolveTransformValue(
  value: object,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): { handled: boolean; value: unknown } {
  if (isLiteralTransform(value)) {
    return { handled: true, value: value.$literal };
  }

  if (isCoalesceTransform(value)) {
    for (const candidate of value.$coalesce) {
      const resolved = resolveTemplateData(candidate, state, index, locals);
      if (
        resolved !== undefined &&
        resolved !== null &&
        !(typeof resolved === 'string' && isUnresolvedTemplateString(resolved))
      ) {
        return { handled: true, value: resolved };
      }
    }
    return { handled: true, value: undefined };
  }

  if (isMapTransform(value)) {
    const source = resolveTemplateData(value.$map.from, state, index, locals);
    if (!Array.isArray(source)) {
      return { handled: true, value: [] };
    }

    const alias = value.$map.as ?? 'item';
    const mapped = source.map((item, itemIndex) => {
      const nextLocals: Record<string, unknown> = locals ? { ...locals } : {};
      nextLocals[alias] = item;
      return resolveTemplateData(value.$map.value, state, itemIndex, nextLocals);
    });
    return { handled: true, value: mapped };
  }

  return { handled: false, value };
}

const SINGLE_EXPR_RE = /^\{\{([^}]+)\}\}$/;
const ALL_EXPR_RE = /\{\{([^}]+)\}\}/g;
const CONDITION_OPERATOR_RE = /^(.*?)(===|!==|==|!=)(.*)$/;

function evaluateExpression(
  expr: string,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): unknown {
  if (!expr.includes('{{')) return parseLiteral(expr);

  const singleMatch = SINGLE_EXPR_RE.exec(expr.trim());
  if (singleMatch) {
    const value = resolvePath(singleMatch[1].trim(), state, index, locals);
    return value === undefined ? expr : value;
  }

  let hadUnresolved = false;
  const resolved = expr.replace(ALL_EXPR_RE, (_match, path: string) => {
    const value = resolvePath(path.trim(), state, index, locals);
    if (value === undefined) {
      hadUnresolved = true;
      return `{{${path.trim()}}}`;
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });

  return hadUnresolved ? resolved : parseLiteral(resolved);
}

const ARRAY_INDEX_RE = /^(.+)\[(\d+)\]$/;

function resolvePath(
  path: string,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): unknown {
  if (path === 'index' && index !== undefined) return index;
  if (locals && path in locals) return locals[path];

  const parts = path.split('.');
  let current: unknown = state;
  let partStart = 0;

  const first = parts[0];
  if (locals && first in locals) {
    current = locals[first];
    partStart = 1;
  }

  for (const part of parts.slice(partStart)) {
    if (current === null || current === undefined) return undefined;
    current = stepIntoPart(current, part);
  }
  return current;
}

function stepIntoPart(current: unknown, part: string): unknown {
  const arrayMatch = ARRAY_INDEX_RE.exec(part);
  if (arrayMatch) {
    return stepIntoArray(current, arrayMatch[1], Number.parseInt(arrayMatch[2], 10));
  }
  if (Array.isArray(current)) {
    const numIndex = Number.parseInt(part, 10);
    return Number.isNaN(numIndex) ? undefined : current[numIndex];
  }
  if (typeof current === 'object') {
    return (current as Record<string, unknown>)[part];
  }
  return undefined;
}

function stepIntoArray(current: unknown, objName: string, arrayIndex: number): unknown {
  if (Array.isArray(current)) return current[arrayIndex];
  if (typeof current === 'object' && current !== null) {
    const obj = (current as Record<string, unknown>)[objName];
    return Array.isArray(obj) ? obj[arrayIndex] : undefined;
  }
  return undefined;
}

function parseLiteral(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function evaluateWorkflowCondition(
  condition: string,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): boolean {
  const trimmed = condition.trim();
  const match = CONDITION_OPERATOR_RE.exec(trimmed);
  if (match) {
    const left = evaluateConditionOperand(match[1].trim(), state, index, locals);
    const right = evaluateConditionOperand(match[3].trim(), state, index, locals);
    const operator = match[2];

    switch (operator) {
      case '===':
        return left === right;
      case '!==':
        return left !== right;
      case '==':
        return left == right;
      case '!=':
        return left != right;
      default:
        return false;
    }
  }

  return isTruthy(resolveTemplateData(trimmed, state, index, locals));
}

function evaluateConditionOperand(
  operand: string,
  state: Record<string, unknown>,
  index?: number,
  locals?: Record<string, unknown>
): unknown {
  if (!operand) return undefined;

  if (operand.includes('{{')) {
    return resolveTemplateData(operand, state, index, locals);
  }

  if (looksLikePath(operand)) {
    const resolved = resolvePath(operand, state, index, locals);
    if (resolved !== undefined) return resolved;
  }

  return parseLiteral(operand);
}

function looksLikePath(value: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*(\[\d+\])?(\.[a-zA-Z_$][a-zA-Z0-9_$]*(\[\d+\])?)*$/.test(value);
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function isUnresolvedTemplateString(value: string): boolean {
  return value.includes('{{') && value.includes('}}');
}

function isLiteralTransform(value: unknown): value is WorkflowLiteralTransform {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$literal' in value &&
    Object.keys(value).length === 1
  );
}

function isCoalesceTransform(value: unknown): value is WorkflowCoalesceTransform {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$coalesce' in value &&
    Array.isArray((value as WorkflowCoalesceTransform).$coalesce)
  );
}

function isMapTransform(value: unknown): value is WorkflowMapTransform {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$map' in value &&
    typeof (value as WorkflowMapTransform).$map === 'object' &&
    (value as WorkflowMapTransform).$map !== null
  );
}

export function hasUnresolvedParams(params: Record<string, unknown>): boolean {
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && value.includes('{{')) {
      return true;
    }
  }
  return false;
}

export function getUnresolvedParamNames(params: Record<string, unknown>): string[] {
  const unresolved: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.includes('{{')) {
      unresolved.push(key);
    }
  }
  return unresolved;
}

export interface IParamResolverContext {
  llmService: ILlmService;
  questionService: IQuestionService;
}

export async function resolveParamsAsync<T>(
  args: Record<string, string>,
  state: Record<string, unknown>,
  toolSchema: z.ZodType<T>,
  ctx: IParamResolverContext,
  index?: number
): Promise<T> {
  const resolved = resolveTemplateExpressions(args, state, index);

  const shape = (toolSchema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (shape) {
    for (const [paramName, paramSchema] of Object.entries(shape)) {
      if (resolved[paramName] !== undefined) continue;

      const isOptional =
        (paramSchema as unknown as { isOptional?: () => boolean }).isOptional?.() ?? false;
      if (isOptional) continue;

      const description =
        (paramSchema as unknown as { description?: string }).description ?? paramName;
      const question = await generateQuestionAsync(ctx.llmService, paramName, description);

      resolved[paramName] = await askAndValidateAsync(ctx.questionService, paramSchema, question);
    }
  }

  return toolSchema.parse(resolved);
}

async function askAndValidateAsync(
  questionService: IQuestionService,
  paramSchema: z.ZodTypeAny,
  question: string
): Promise<unknown> {
  const answer = await questionService.input({ message: question });
  try {
    return paramSchema.parse(answer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryAnswer = await questionService.input({
      message: `${question}\n\nInvalid input: ${message}. Please try again.`,
    });
    return paramSchema.parse(retryAnswer);
  }
}

async function generateQuestionAsync(
  llmService: ILlmService,
  paramName: string,
  description: string
): Promise<string> {
  try {
    const response = await llmService.rawChat(
      `You are a workflow parameter question generator. Generate a clear, concise question to ask the user for a missing parameter.

Rules:
- Make the question specific and actionable
- Include the parameter name and description
- If the parameter is a choice, suggest options
- Keep it under 50 words
- Return ONLY the question text, nothing else`,
      [
        {
          role: 'user',
          content: `Parameter: ${paramName}\nDescription: ${description}`,
        },
      ],
      { maxTokens: 100 }
    );
    return response.trim();
  } catch {
    return `Please provide a value for "${paramName}": ${description}`;
  }
}
