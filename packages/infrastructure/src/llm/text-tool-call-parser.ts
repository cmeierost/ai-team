import type { ITextToolCallParser } from '@ai-team/core';
import { InfrastructureTextToolParserService } from './text-tool-call-parser.service.js';

export class InfrastructureTextToolCallParser implements ITextToolCallParser {
  constructor(
    private readonly parserService: InfrastructureTextToolParserService = new InfrastructureTextToolParserService()
  ) {}

  parseTextToolCalls(text: string, tools: Set<string>) {
    return this.parserService.parseTextToolCalls(text, tools);
  }
}
