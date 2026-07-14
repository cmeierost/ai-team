export interface RuntimeToolEvidence {
  toolName: string;
  args: Record<string, unknown>;
  status: 'success' | 'failed' | 'partial' | 'mixed';
  content?: string;
  error?: string;
  sourceType: 'tool';
  confidence: 'direct';
}

export class LlmToolEvidenceBuilder {
  buildRuntimeToolEvidence(
    toolResult: Pick<
      { toolName: string; result: unknown; isError?: boolean },
      'toolName' | 'result' | 'isError'
    >,
    args: Record<string, unknown>
  ): RuntimeToolEvidence {
    if (toolResult.isError) {
      return {
        toolName: toolResult.toolName,
        args,
        status: 'failed',
        error: this.stringifyToolPayload(toolResult.result),
        sourceType: 'tool',
        confidence: 'direct',
      };
    }

    return {
      toolName: toolResult.toolName,
      args,
      status: 'success',
      content: this.stringifyToolPayload(toolResult.result),
      sourceType: 'tool',
      confidence: 'direct',
    };
  }

  private stringifyToolPayload(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload;
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return String(payload);
    }
  }
}
