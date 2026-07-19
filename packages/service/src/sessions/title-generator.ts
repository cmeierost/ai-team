import {
  ChatMessage,
  type ITitleGenerator,
  type IMessagesRepository,
  type ISessionsRepository,
} from '@ai-team/core';

export class TitleGenerator implements ITitleGenerator {
  constructor(
    private readonly messages: IMessagesRepository,
    private readonly sessions: ISessionsRepository
  ) {}

  async generateTitle(sessionId: string, llmService: unknown): Promise<string> {
    const existingThreadTitle = await this.getExistingThreadTitle(sessionId);
    if (existingThreadTitle) {
      await this.applyThreadTitle(sessionId, existingThreadTitle);
      return existingThreadTitle;
    }

    // Use only the first 2 human messages — agent intro messages add noise, not signal.
    const humanMessages = await this.messages.queryMessages({ sessionId, isHuman: true, limit: 2 });
    const contextMessages = humanMessages.filter((m) => m.content?.trim());

    const fallbackTitle = this.buildFallbackActionTitle(contextMessages);

    let title = fallbackTitle;
    if (contextMessages.length > 0) {
      try {
        // Use LLM to generate title
        const generated = await (llmService as any).generateTitle(contextMessages);
        const normalized = this.normalizeTitle(generated);
        title = normalized && !this.isWeakGeneratedTitle(normalized) ? normalized : fallbackTitle;
      } catch (error) {
        console.warn('[TitleGenerator] Title generation failed, using fallback title.', error);
      }
    }

    await this.applyThreadTitle(sessionId, title);

    return title;
  }

  async setThreadTitle(sessionId: string, title: string): Promise<void> {
    await this.applyThreadTitle(sessionId, title);
  }

  async summarizeForContextAsync(
    sourceText: string,
    maxWords?: number,
    focusInstruction?: string
  ): Promise<string>;
  async summarizeForContextAsync(
    llmService: unknown,
    sourceText: string,
    maxWords?: number,
    focusInstruction?: string
  ): Promise<string>;
  async summarizeForContextAsync(
    arg1: unknown,
    arg2?: string | number,
    arg3?: number | string,
    arg4?: string
  ): Promise<string> {
    const hasInjectedLlm = typeof arg1 !== 'string';
    const llmService = hasInjectedLlm ? arg1 : null;
    const sourceText = (hasInjectedLlm ? arg2 : arg1) as string;
    const maxWords = (hasInjectedLlm ? arg3 : arg2) as number | undefined;
    const focusInstruction = (hasInjectedLlm ? arg4 : arg3) as string | undefined;

    if (!llmService) {
      throw new Error('TitleGenerator.summarizeForContextAsync requires an LLM service.');
    }

    return this.summarizeHierarchicalAsync(
      llmService as any,
      sourceText,
      maxWords ?? 200,
      focusInstruction
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getExistingThreadTitle(sessionId: string): Promise<string | null> {
    const chain = await this.getSessionChain(sessionId);
    for (const session of chain) {
      const normalized = this.normalizeTitle(session.title ?? '');
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private async applyThreadTitle(sessionId: string, title: string): Promise<void> {
    const normalizedTitle = this.normalizeTitle(title);
    if (!normalizedTitle) {
      return;
    }

    const chain = await this.getSessionChain(sessionId);
    await Promise.all(
      chain
        .filter((session) => this.normalizeTitle(session.title ?? '') !== normalizedTitle)
        .map((session) => this.sessions.updateSession(session.id, { title: normalizedTitle }))
    );
  }

  /**
   * Walk the previousSessionId chain from the given session back to the root.
   * Returns sessions ordered root → leaf (oldest first).
   */
  private async getSessionChain(sessionId: string): Promise<any[]> {
    const upwardChain: any[] = [];
    const visited = new Set<string>();
    let current: any = await this.sessions.getSession(sessionId);

    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      upwardChain.push(current);
      if (!current.previousSessionId) break;
      current = await this.sessions.getSession(current.previousSessionId);
    }

    upwardChain.reverse();
    return upwardChain;
  }

  private normalizeTitle(input: string | undefined | null): string {
    if (!input) return '';
    let result = input
      .replaceAll(/[\r\n\t]+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();

    while (result.startsWith("'") || result.startsWith('"')) {
      result = result.slice(1);
    }
    while (result.endsWith("'") || result.endsWith('"')) {
      result = result.slice(0, -1);
    }
    return result;
  }

  private buildFallbackActionTitle(messages: ChatMessage[]): string {
    const source = messages
      .filter((m) => m.isHuman)
      .map((m) => m.content ?? '')
      .join(' ')
      .toLowerCase();

    const stopwords = new Set([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'by',
      'for',
      'from',
      'how',
      'i',
      'in',
      'is',
      'it',
      'let',
      'lets',
      'my',
      'of',
      'on',
      'or',
      'the',
      'this',
      'to',
      'we',
      'with',
      'future',
      'you',
      'me',
      'please',
      'can',
      'could',
      'would',
      'should',
      'need',
      'want',
    ]);

    const actionVerbMap: Record<string, string> = {
      fix: 'Fix',
      create: 'Create',
      add: 'Add',
      update: 'Update',
      improve: 'Improve',
      refactor: 'Refactor',
      debug: 'Debug',
      test: 'Test',
      write: 'Write',
      implement: 'Implement',
      build: 'Build',
      generate: 'Generate',
      set: 'Set',
      make: 'Make',
      plan: 'Plan',
      retire: 'Retire',
      retiring: 'Retire',
      archive: 'Archive',
      offboard: 'Offboard',
      decommission: 'Decommission',
      sunset: 'Sunset',
    };

    const words = source
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const hasAgentToken = words.some((w) => w === 'agent' || w === 'agents');
    const hasRetirementToken = words.some((w) =>
      [
        'retire',
        'retiring',
        'retirement',
        'archive',
        'offboard',
        'decommission',
        'sunset',
      ].includes(w)
    );
    if (hasAgentToken && hasRetirementToken) {
      return 'Plan Agent Retirement';
    }

    let action = 'Improve';
    const actionWord = words.find((w) => actionVerbMap[w]);
    if (actionWord) {
      action = actionVerbMap[actionWord];
    }

    const topicWords: string[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      if (word.length < 3 || stopwords.has(word) || actionVerbMap[word]) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      topicWords.push(word.charAt(0).toUpperCase() + word.slice(1));
      if (topicWords.length >= 3) break;
    }

    if (topicWords.length === 0) {
      return `${action} Request`;
    }

    return `${action} ${topicWords.join(' ')}`.trim();
  }

  private isWeakGeneratedTitle(title: string): boolean {
    const normalized = title
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();

    if (!normalized) return true;
    if (normalized === 'let plan future want') return true;

    const weakTitles = new Set([
      'new conversation',
      'conversation',
      'general request',
      'task request',
      'title request',
      'help request',
    ]);
    if (weakTitles.has(normalized)) return true;

    const words = normalized.split(' ').filter(Boolean);
    if (words.length < 2) return true;

    if (words[0] === 'let' || words[0] === 'lets') return true;

    const noisyWords = new Set(['let', 'lets', 'future', 'want', 'thing', 'things', 'stuff']);
    const contentWords = words.filter((w) => !noisyWords.has(w));
    return contentWords.length === 0;
  }

  private buildSummaryInstructionText(maxWords: number, focusInstruction?: string): string {
    const focus = focusInstruction?.trim();
    const focusSection = focus ? `\nFocus guidance: ${focus}\n` : '';
    return (
      `Produce a compact Markdown summary that is clearly shorter than the source. ` +
      `Write at most ${maxWords} words and avoid repeating source wording verbatim. ` +
      `Keep only key facts, decisions, risks, and action items. ` +
      `Drop examples, repetition, and filler text. ` +
      `Use bullet points only when listing multiple distinct items. ` +
      focusSection
    );
  }

  private async summarizeTextAsync(
    llmService: any,
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const fakeAgent = { id: 'system', name: 'System', role: 'system', systemPrompt: '' };
    const prompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Source:\n${sourceText}`;
    return llmService.chat(fakeAgent, [{ role: 'user', content: prompt }], {
      maxTokens: Math.max(220, maxWords * 3),
    });
  }

  private async summarizeHierarchicalAsync(
    llmService: any,
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const chunks = this.splitIntoChunks(sourceText, 5000);

    if (chunks.length <= 1) {
      const summary = await this.summarizeTextAsync(
        llmService,
        sourceText,
        maxWords,
        focusInstruction
      );
      return summary.trim();
    }

    const fakeAgent = { id: 'system', name: 'System', role: 'system', systemPrompt: '' };
    const chunkSummaries: string[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkPrompt =
        `Summarize this section (${index + 1}/${chunks.length}) of a larger document. ` +
        `Keep this section summary concise (45-80 words) and strictly shorter than this section. ` +
        `Focus on facts, decisions, and actions.` +
        (focusInstruction?.trim() ? `\nFocus guidance: ${focusInstruction.trim()}\n` : '\n') +
        `\nSection:\n${chunks[index]}`;

      const chunkSummary = await llmService.chat(
        fakeAgent,
        [{ role: 'user', content: chunkPrompt }],
        {
          maxTokens: 420,
        }
      );
      chunkSummaries.push(chunkSummary.trim());
    }

    const finalPrompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Combine these section summaries into one final summary:\n` +
      chunkSummaries.map((summary, index) => `\nSection ${index + 1}:\n${summary}`).join('\n');

    const finalSummary = await llmService.chat(
      fakeAgent,
      [{ role: 'user', content: finalPrompt }],
      {
        maxTokens: Math.max(260, maxWords * 3),
      }
    );
    return finalSummary.trim();
  }

  private splitIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      let end = i + chunkSize;
      // Try to break at paragraph boundary
      if (end < text.length) {
        const breakPoint = text.lastIndexOf('\n\n', end);
        if (breakPoint > i + chunkSize * 0.5) {
          end = breakPoint;
        }
      }
      chunks.push(text.slice(i, end));
    }
    return chunks;
  }
}
