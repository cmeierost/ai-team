import type { IChatService, ChatSummary, ChatMessage, MessageStats } from '@ai-team/api-contracts';
import type { SessionManager } from '../session-manager.js';
import { BadRequestError, NotFoundError } from '../http-errors.js';
import type { ILlmService, IChatManager, IChatStorage } from '@ai-team/core';
import type { IInteractionService } from '../interaction-service.js';

export class ChatService implements IChatService {
  constructor(
    private readonly interactionService: IInteractionService,
    private readonly sessionManager: SessionManager,
    private readonly mgr: IChatManager,
    private readonly storage: IChatStorage,
    private readonly llmService: ILlmService
  ) {}

  private parseIndex(index: string): number {
    const idx = Number.parseInt(index, 10);
    if (Number.isNaN(idx)) {
      throw new BadRequestError('invalid index');
    }
    return idx;
  }

  private serializeToolResultForLlm(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  private fallbackSummarizeText(
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): string {
    const normalized = sourceText.replaceAll(/\s+/g, ' ').trim();
    if (!normalized) {
      return 'No tool result content was available to summarize.';
    }

    const clampedMaxWords = Math.max(1, Math.min(500, Math.floor(maxWords) || 200));
    const commandSummary = this.trySummarizeCommandExecutionPayload(
      sourceText,
      clampedMaxWords,
      focusInstruction
    );
    if (commandSummary) {
      return commandSummary;
    }

    const focusTerms = (focusInstruction ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((term) => term.length >= 3);
    const genericTerms = [
      'change',
      'changed',
      'changes',
      'error',
      'errors',
      'fail',
      'failed',
      'warning',
      'warnings',
      'added',
      'removed',
      'updated',
      'fix',
      'issue',
      'result',
      'summary',
      'impact',
    ];
    const scoringTerms = new Set([...genericTerms, ...focusTerms]);

    const sentences = normalized
      .split(/(?<=[.!?])\s+|\n+/g)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);

    if (sentences.length === 0) {
      return normalized;
    }

    const ranked = sentences
      .map((sentence, index) => {
        const lower = sentence.toLowerCase();
        let score = 0;
        for (const term of scoringTerms) {
          if (lower.includes(term)) {
            score += focusTerms.includes(term) ? 3 : 1;
          }
        }
        if (/\b(error|fail|warning|changed|added|removed|updated|fix)\b/i.test(sentence)) {
          score += 2;
        }
        if (sentence.length < 20) {
          score -= 1;
        }
        if (sentence.length > 260) {
          score -= 1;
        }
        return { sentence, index, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const selected: Array<{ sentence: string; index: number }> = [];
    let usedWords = 0;
    const wordBudget = Math.max(1, clampedMaxWords);

    for (const candidate of ranked) {
      const sentenceWords = this.countWords(candidate.sentence);
      if (sentenceWords === 0) {
        continue;
      }
      if (usedWords + sentenceWords > wordBudget && selected.length > 0) {
        continue;
      }
      selected.push({ sentence: candidate.sentence, index: candidate.index });
      usedWords += sentenceWords;
      if (usedWords >= wordBudget) {
        break;
      }
      if (selected.length >= 5) {
        break;
      }
    }

    const summaryCore = (selected.length > 0 ? selected : ranked.slice(0, 2))
      .sort((a, b) => a.index - b.index)
      .map((item) => `- ${item.sentence.replaceAll(/\s+/g, ' ').trim()}`)
      .join('\n');

    let summary = summaryCore.trim();
    if (!summary) {
      summary = `- ${sentences[0]}`;
    }

    if (this.countBytes(summary) >= this.countBytes(normalized)) {
      const hardCharLimit = Math.max(1, Math.min(normalized.length - 1, clampedMaxWords * 6));
      summary =
        normalized.length > hardCharLimit
          ? `${normalized.slice(0, Math.max(1, hardCharLimit - 1)).trimEnd()}…`
          : normalized.slice(0, Math.max(1, normalized.length - 1)).trimEnd();
    }

    return summary;
  }

  private trySummarizeCommandExecutionPayload(
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): string | null {
    let parsed: any;
    try {
      parsed = JSON.parse(sourceText);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const command = typeof parsed.command === 'string' ? parsed.command.trim() : '';
    const status = typeof parsed.status === 'string' ? parsed.status.trim() : '';
    const output = typeof parsed.output === 'string' ? parsed.output : '';
    if (!command && !output) {
      return null;
    }

    const outputLines = output
      .split(/\r?\n/g)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('$'));

    const rawOutputLines = output.split(/\r?\n/g);

    const modifiedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    let inUntrackedSection = false;

    for (const rawLine of rawOutputLines) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (/^Untracked files:\s*$/i.test(trimmed)) {
        inUntrackedSection = true;
        continue;
      }

      if (/^Changes not staged for commit:\s*$/i.test(trimmed)) {
        inUntrackedSection = false;
        continue;
      }

      const modifiedMatch = /^\s*modified:\s+(.+)$/i.exec(line);
      if (modifiedMatch?.[1]) {
        modifiedFiles.push(modifiedMatch[1].trim());
        continue;
      }

      if (inUntrackedSection) {
        if (!line.startsWith(' ') && !line.startsWith('\t')) {
          continue;
        }
        if (/^\s*\(/.test(line)) {
          continue;
        }
        const candidate = trimmed;
        if (candidate && !/^no changes added to commit/i.test(candidate)) {
          untrackedFiles.push(candidate);
        }
      }
    }

    const mergedOutput = outputLines.join(' ');
    const branchMatch = /\bOn branch\s+([^\s]+)/i.exec(mergedOutput);
    const hasUnstaged = /\bChanges not staged for commit\b/i.test(mergedOutput);
    const hasStaged = /\bChanges to be committed\b/i.test(mergedOutput);
    const hasUntracked = /\bUntracked files\b/i.test(mergedOutput);
    const isClean =
      /\bworking tree clean\b/i.test(mergedOutput) || /\bnothing to commit\b/i.test(mergedOutput);

    const areaFromPath = (filePath: string): string => {
      const segments = filePath.split('/').filter(Boolean);
      if (segments.length >= 2 && segments[0] === 'packages') {
        return `packages/${segments[1]}`;
      }
      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`;
      }
      return segments[0] ?? filePath;
    };

    const areaCounts = new Map<string, number>();
    for (const filePath of [...modifiedFiles, ...untrackedFiles]) {
      const area = areaFromPath(filePath);
      areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    }
    const topAreas = [...areaCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3);

    const bullets: string[] = [];
    if (command) {
      bullets.push(`- Command: ${command}`);
    }
    if (status) {
      bullets.push(`- Status: ${status}`);
    }
    if (branchMatch?.[1]) {
      bullets.push(`- Branch: ${branchMatch[1]}`);
    }
    if (hasUnstaged) {
      bullets.push('- Git state: unstaged local changes are present.');
    }
    if (hasStaged) {
      bullets.push('- Git state: staged changes are ready to commit.');
    }
    if (hasUntracked) {
      bullets.push('- Git state: untracked files are present.');
    }
    if (isClean) {
      bullets.push('- Git state: working tree is clean.');
    }

    if (modifiedFiles.length > 0 || untrackedFiles.length > 0) {
      bullets.push(
        `- Change volume: ${modifiedFiles.length} modified, ${untrackedFiles.length} untracked files.`
      );
    }

    if (topAreas.length > 0) {
      const areasText = topAreas.map(([area, count]) => `${area} (${count})`).join(', ');
      bullets.push(`- Most changed areas: ${areasText}.`);
    }

    if (untrackedFiles.length > 0) {
      bullets.push(
        `- New files: ${untrackedFiles.slice(0, 3).join(', ')}${untrackedFiles.length > 3 ? ', …' : ''}`
      );
    }

    if (focusInstruction?.trim()) {
      const focus = focusInstruction.trim();
      if (
        /what changed the most|changed most|biggest changes?/i.test(focus) &&
        topAreas.length > 0
      ) {
        const [topArea, topCount] = topAreas[0];
        bullets.push(
          `- Focus answer: the largest change concentration is in ${topArea} (${topCount} files).`
        );
      } else {
        bullets.push(`- Focus requested: ${focus}`);
      }
    }

    if (bullets.length === 0 && outputLines.length > 0) {
      bullets.push(`- Key output: ${outputLines[0]}`);
    }

    if (bullets.length === 0) {
      return null;
    }

    let summary = bullets.join('\n');
    while (this.countWords(summary) > maxWords && bullets.length > 1) {
      bullets.pop();
      summary = bullets.join('\n');
    }

    if (this.countBytes(summary) >= this.countBytes(sourceText)) {
      return null;
    }

    return summary;
  }

  private countWords(text: string): number {
    const normalized = text.replaceAll(/\s+/g, ' ').trim();
    return normalized ? normalized.split(' ').length : 0;
  }

  private countBytes(text: string): number {
    return new TextEncoder().encode(text).length;
  }

  private isCompressedEnough(sourceText: string, summaryText: string): boolean {
    const sourceWordCount = this.countWords(sourceText);
    const summaryWordCount = this.countWords(summaryText);
    const sourceByteCount = this.countBytes(sourceText);
    const summaryByteCount = this.countBytes(summaryText);

    const wordCompressed = sourceWordCount <= 8 || summaryWordCount < sourceWordCount;
    const byteCompressed = sourceByteCount <= 128 || summaryByteCount < sourceByteCount;
    return wordCompressed && byteCompressed;
  }

  private async resolveToolCallTargetAsync(
    agentId: string,
    index: string,
    requestedToolCallId?: number,
    options?: { preferRawResult?: boolean }
  ): Promise<{
    targetMessageId: number;
    toolCallId: number;
    sourceText: string;
  }> {
    const idx = this.parseIndex(index);
    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) throw new NotFoundError('session not found');

    const messages = await this.sessionManager.listSessionMessages(session.id);
    if (idx < 0 || idx >= messages.length) throw new NotFoundError('message not found');

    const targetMessage = messages[idx] as ChatMessage & {
      id?: number;
      tool_calls?: Array<{ id?: number; result?: unknown; resultLlm?: unknown }>;
    };

    if (typeof targetMessage.id !== 'number') {
      throw new NotFoundError('message id not found');
    }

    const toolCalls = Array.isArray(targetMessage.tool_calls) ? targetMessage.tool_calls : [];
    const targetToolCall =
      typeof requestedToolCallId === 'number'
        ? toolCalls.find((call) => call.id === requestedToolCallId)
        : [...toolCalls].reverse().find((call) => typeof call.id === 'number');

    if (!targetToolCall || typeof targetToolCall.id !== 'number') {
      throw new NotFoundError('tool call not found');
    }

    const rawResultText =
      targetToolCall.result !== undefined
        ? this.serializeToolResultForLlm(targetToolCall.result)
        : undefined;

    const sourceTextRaw = options?.preferRawResult
      ? (rawResultText ?? targetMessage.content)
      : ((typeof targetToolCall.resultLlm === 'string' && targetToolCall.resultLlm.trim().length > 0
          ? targetToolCall.resultLlm
          : undefined) ??
        rawResultText ??
        targetMessage.content);

    const clipped =
      sourceTextRaw.length > 24_000
        ? `${sourceTextRaw.slice(0, 24_000)}\n...[clipped]`
        : sourceTextRaw;

    return {
      targetMessageId: targetMessage.id,
      toolCallId: targetToolCall.id,
      sourceText: clipped,
    };
  }

  async getSummaries(): Promise<ChatSummary[]> {
    return this.mgr.loadSummaries();
  }

  async getMessages(
    agentId: string,
    query?: { includeArchived?: boolean }
  ): Promise<ChatMessage[]> {
    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) return [];
    const messages = await this.sessionManager.getSessionMessages(session.id);
    return (
      query?.includeArchived ? messages : messages.filter((m: any) => !m.archived)
    ) as ChatMessage[];
  }

  async post(
    agentId: string,
    body: { content: string; pendingIntroduction?: string }
  ): Promise<{ content: string; handoff?: unknown }> {
    if (!body.content || typeof body.content !== 'string')
      throw new BadRequestError('content is required');
    const stream = this.interactionService.stream({
      command: 'chat',
      payload: {
        employeeId: agentId,
        options: {
          message: body.content,
          oneShot: true,
          ...(body.pendingIntroduction ? { pendingIntroduction: body.pendingIntroduction } : {}),
        },
      },
    });
    let reply = '';
    let handoffEvent: unknown = null;
    for await (const event of stream) {
      if ((event as any).kind === 'token') reply += (event as any).text;
      else if ((event as any).kind === 'handoff') handoffEvent = event;
      else if ((event as any).kind === 'error') throw new Error((event as any).message);
    }
    const resp: Record<string, unknown> = { content: reply.trim() };
    if (handoffEvent) resp.handoff = handoffEvent;
    return resp as { content: string; handoff?: unknown };
  }

  async editMessage(
    agentId: string,
    index: string,
    body: { content: string }
  ): Promise<ChatMessage> {
    const idx = parseInt(index, 10);
    if (isNaN(idx)) throw new BadRequestError('invalid index');
    const updated = await this.mgr.editMessage(agentId, idx, body.content);
    if (updated === undefined || updated === null) throw new NotFoundError('message not found');
    return updated;
  }

  async archiveMessage(agentId: string, index: string): Promise<{ ok: boolean }> {
    const idx = parseInt(index, 10);
    if (isNaN(idx)) throw new BadRequestError('invalid index');

    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) throw new NotFoundError('session not found');

    const messages = await this.sessionManager.listSessionMessages(session.id);
    if (idx < 0 || idx >= messages.length) throw new NotFoundError('message not found');

    const targetMessage = messages[idx];
    if (typeof targetMessage.id !== 'number') throw new NotFoundError('message id not found');

    const ok = await this.sessionManager.setMessageHiddenFromLlm(targetMessage.id, true);
    if (!ok) throw new NotFoundError('message not found');

    return { ok: true };
  }

  async unarchiveMessage(agentId: string, index: string): Promise<{ ok: boolean }> {
    const idx = parseInt(index, 10);
    if (isNaN(idx)) throw new BadRequestError('invalid index');

    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) throw new NotFoundError('session not found');

    const messages = await this.sessionManager.listSessionMessages(session.id);
    if (idx < 0 || idx >= messages.length) throw new NotFoundError('message not found');

    const targetMessage = messages[idx];
    if (typeof targetMessage.id !== 'number') throw new NotFoundError('message id not found');

    const ok = await this.sessionManager.setMessageHiddenFromLlm(targetMessage.id, false);
    if (!ok) throw new NotFoundError('message not found');

    return { ok: true };
  }

  async setToolResultHidden(
    agentId: string,
    index: string,
    body: { hidden: boolean; toolCallId?: number }
  ): Promise<{ ok: boolean; hidden: boolean; toolCallId: number }> {
    if (typeof body?.hidden !== 'boolean') {
      throw new BadRequestError('hidden must be a boolean');
    }

    const { toolCallId, sourceText } = await this.resolveToolCallTargetAsync(
      agentId,
      index,
      body.toolCallId
    );

    await this.sessionManager.updateToolCallLlmResult(toolCallId, body.hidden ? '' : sourceText);

    return { ok: true, hidden: body.hidden, toolCallId };
  }

  async summarizeToolResult(
    agentId: string,
    index: string,
    body?: { toolCallId?: number; maxWords?: number; focusInstruction?: string }
  ): Promise<{ ok: boolean; toolCallId: number; summary: string }> {
    const maxWords =
      typeof body?.maxWords === 'number' && body.maxWords > 0
        ? Math.min(500, Math.floor(body.maxWords))
        : 200;
    const focusInstruction =
      typeof body?.focusInstruction === 'string' ? body.focusInstruction.trim() : undefined;

    const { toolCallId, sourceText } = await this.resolveToolCallTargetAsync(
      agentId,
      index,
      body?.toolCallId,
      { preferRawResult: true }
    );

    let normalizedSummary = '';
    try {
      await this.llmService.ensureInitialized();
      const summary = await this.sessionManager.summarizeForContextAsync(
        this.llmService,
        sourceText,
        maxWords,
        focusInstruction || undefined
      );
      normalizedSummary = summary.trim();
      if (!normalizedSummary) {
        throw new Error('LLM summary was empty');
      }

      if (!this.isCompressedEnough(sourceText, normalizedSummary)) {
        const stricterFocus = [
          focusInstruction?.trim() || null,
          'Be significantly shorter than the source. Summarize key changes, decisions, and outcomes only.',
        ]
          .filter(Boolean)
          .join(' ');

        const strictSummary = await this.sessionManager.summarizeForContextAsync(
          this.llmService,
          sourceText,
          Math.max(20, Math.floor(maxWords * 0.8)),
          stricterFocus
        );

        const strictNormalized = strictSummary.trim();
        normalizedSummary =
          strictNormalized && this.isCompressedEnough(sourceText, strictNormalized)
            ? strictNormalized
            : this.fallbackSummarizeText(sourceText, maxWords, focusInstruction);
      }
    } catch (error) {
      console.warn('Falling back to deterministic tool-result summary:', error);
      normalizedSummary = this.fallbackSummarizeText(sourceText, maxWords, focusInstruction);
    }

    await this.sessionManager.updateToolCallLlmResult(toolCallId, normalizedSummary);

    return { ok: true, toolCallId, summary: normalizedSummary };
  }

  async clearHistory(agentId: string): Promise<{ ok: boolean }> {
    await this.storage.clearChatHistory(agentId);
    return { ok: true };
  }

  async getStats(agentId: string): Promise<MessageStats> {
    return this.mgr.getMessageStats(agentId);
  }
}
