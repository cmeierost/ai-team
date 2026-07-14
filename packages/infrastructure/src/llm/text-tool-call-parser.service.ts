import type { ParsedTextToolCall } from './llm-text-tool-parser.js';
import { LlmTextToolParser } from './llm-text-tool-parser.js';

export class InfrastructureTextToolParserService {
  private readonly parser = new LlmTextToolParser();

  parseBracketToolCalls(text: string, tools: Set<string>): ParsedTextToolCall[] {
    return this.parser.parseBracketToolCalls(text, tools);
  }

  parseTextToolCalls(text: string, tools: Set<string>): ParsedTextToolCall[] {
    return this.parser.parseTextToolCalls(text, tools);
  }
}
