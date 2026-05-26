import type { ITextToolCallParser } from '@ai-team/core';
import { parseTextToolCalls } from './index.js';

export class InfrastructureTextToolCallParser implements ITextToolCallParser {
  parseTextToolCalls(text: string, tools: Set<string>) {
    return parseTextToolCalls(text, tools);
  }
}