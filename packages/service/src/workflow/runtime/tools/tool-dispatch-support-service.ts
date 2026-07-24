import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  CommandResponse,
  ExecutionContext,
  IEmitService,
  ILlmService,
  IProposalStoreFactory,
  IToolSerializationService,
  IToolDispatchSupportService,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from '@ai-team/core';
import type { FsPathAccessEnvelope } from '../../../commands/fs/fs-access.js';

export type ToolDenialKind = 'user-denied' | 'policy-denied' | 'execution-failed';

export interface ToolDenial {
  kind: ToolDenialKind;
  reasonCode: string;
  message: string;
  blockedPaths?: string[];
  alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
  handoffRecommendation?: {
    possible: boolean;
    requiresUserApproval: true;
    contexts: Array<{ contextId: string; allowedPaths: string[] }>;
  };
}

export interface FileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
}

interface ToolHistoryIntent {
  mode?: 'summary' | 'analysis';
  regex?: string;
  regexFlags?: string;
  search?: string;
  lineStart?: number;
  lineEnd?: number;
  firstLines?: number;
  lastLines?: number;
  maxChars?: number;
}

interface PreparedHistoryOutput {
  output: string;
  filtered: boolean;
  label?: string;
}

interface ProposalSaveData {
  proposalId: string;
  agentName: string;
  description: string;
  createdAt: string;
  files: Array<{ filePath: string; oldContent: string; newContent: string }>;
}

interface IProposalStore {
  save(proposal: ProposalSaveData): void;
}

// Tools whose results never need human approval (read-only / info-only).
const SILENT_TOOL_PREFIXES = ['find_', 'list_', 'read_', 'search_', 'get_'];
const SILENT_TOOL_NAMES = new Set([
  'com_handoff', // orchestration — already requires delegation permission
  'com_ask', // interactive clarification tool (must not trigger confirmation recursion)
  'hr_hire', // requires manage-agents permission (checked by ToolManager)
  'http_fetch',
  'http_crawl',
  'fs_who_should',
  'tool_list',
  'team_list',
  'fs_read',
  'fs_write',
  'fs_info',
  'fs_tree',
  'fs_search',
  'lsp',
]);

export class ToolDispatchSupportService implements IToolDispatchSupportService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly serialization: IToolSerializationService,
    private readonly llmService: ILlmService,
    private readonly proposalStoreFactory: IProposalStoreFactory
  ) {}

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  formatArgs(args: unknown): string {
    return this.serialization.formatArgs(args);
  }

  serialise(value: unknown): string {
    return this.serialization.serialise(value);
  }

  formatToolResultPreview(outputText: string): string {
    return this.serialization.formatToolResultPreview(outputText);
  }

  requiresConfirmation(toolName: string): boolean {
    if (SILENT_TOOL_NAMES.has(toolName)) return false;
    if (SILENT_TOOL_PREFIXES.some((p) => toolName.startsWith(p))) return false;
    return true;
  }

  toToolDenialEvent(denial: ToolDenial): ToolDenialEvent {
    return {
      kind: denial.kind,
      reasonCode: denial.reasonCode,
      message: denial.message,
      blockedPaths: denial.blockedPaths,
      alternativeContexts: denial.alternativeContexts,
      handoffRecommendation: denial.handoffRecommendation,
    };
  }

  extractFileChanges(result: unknown): FileChange[] {
    if (result == null || typeof result !== 'object') return [];
    const r = result as Record<string, unknown>;
    if (!Array.isArray(r._fileChanges)) return [];
    return r._fileChanges as FileChange[];
  }

  stripFileChanges(result: unknown): unknown {
    if (result == null || typeof result !== 'object') return result;
    const r = result as Record<string, unknown>;
    if (!('_fileChanges' in r)) return result;
    const { _fileChanges: _, ...rest } = r;
    return rest;
  }

  buildToolRuntimePayload(
    toolName: string,
    outcome: ToolRuntimePayloadEvent['outcome'],
    request: unknown,
    commandResponse: CommandResponse | undefined,
    denial?: ToolDenial,
    resultLlm?: string,
    fileChanges?: FileChange[]
  ): ToolRuntimePayloadEvent {
    return {
      toolName,
      outcome,
      request,
      commandResponse,
      resultLlm,
      fileChanges,
      denial: denial ? this.toToolDenialEvent(denial) : undefined,
    };
  }

  buildPendingToolRuntimePayload(
    toolName: string,
    phase: 'request' | 'start',
    request: unknown,
    longRunning = false
  ): ToolRuntimePayloadEvent {
    return {
      toolName,
      outcome: phase,
      request,
      commandResponse: undefined,
      resultLlm: undefined,
      denial: undefined,
      longRunning,
    };
  }

  buildToolCommandResponse(
    toolName: string,
    message: string,
    result: unknown,
    denial?: ToolDenial
  ): CommandResponse {
    if (denial) {
      return {
        status: 'error',
        message,
        data: result,
        error: {
          code: denial.reasonCode,
          message,
          details: {
            toolName,
            kind: denial.kind,
            blockedPaths: denial.blockedPaths,
            alternativeContexts: denial.alternativeContexts,
          },
        },
      };
    }

    return {
      status: 'ok',
      message,
      data: result,
    };
  }

  classifyToolDenial(ok: boolean, result: unknown, message: string): ToolDenial | undefined {
    if (!ok) {
      return {
        kind: 'execution-failed',
        reasonCode: 'tool_execution_failed',
        message,
      };
    }

    if (!result || typeof result !== 'object') return undefined;
    const payload = result as Record<string, unknown>;

    const status = typeof payload.status === 'string' ? payload.status : undefined;
    const permissionDenied = status === 'permission_denied';
    const access = payload.access;
    const accessDenied = this.isAccessEnvelope(access) && !access.allowed;

    if (!permissionDenied && !accessDenied) return undefined;

    const rawAltContexts = this.extractAlternativeContexts(payload);

    return {
      kind: 'policy-denied',
      reasonCode: permissionDenied ? 'permission_denied' : 'access_denied',
      message:
        typeof payload.message === 'string' ? payload.message : 'Tool call denied by policy.',
      blockedPaths: this.extractBlockedPaths(payload),
      alternativeContexts: rawAltContexts,
      handoffRecommendation: {
        possible: rawAltContexts.length > 0,
        requiresUserApproval: true,
        contexts: rawAltContexts,
      },
    };
  }

  async prepareToolOutputForHistory(
    ctx: ExecutionContext,
    toolName: string,
    output: string
  ): Promise<PreparedHistoryOutput> {
    const latestUserText = this.getLatestHumanMessageText(ctx);
    const intent = this.parseToolHistoryIntent(latestUserText);
    const deterministic = this.applyDeterministicFilters(output, intent);

    if (intent.mode) {
      const llmTransformed = await this.applyLlmTransform(
        toolName,
        deterministic.output,
        intent.mode
      );
      if (llmTransformed) {
        return {
          output: llmTransformed,
          filtered: true,
          label: `${intent.mode},${deterministic.label}`,
        };
      }
    }

    return {
      output: deterministic.output,
      filtered: deterministic.changed,
      label: deterministic.label,
    };
  }

  async persistCodeEditProposal(
    result: unknown,
    args: unknown,
    ctx: ExecutionContext,
    emitService: IEmitService
  ): Promise<void> {
    const r = result as Record<string, unknown>;
    if (r?.status !== 'pending_approval') return;

    const proposalId = r.proposalId as string;
    const changes = ((args as any)?.changes ?? []) as Array<{
      filePath: string;
      oldContent: string;
      newContent: string;
    }>;

    const resolvedFiles = await this.resolveProposalFiles(changes);
    const store = this.resolveProposalStore();

    const { agentName } = this.resolveAgentIdentity(ctx);
    store.save({
      proposalId,
      agentName,
      description: (r.description as string) ?? '',
      createdAt: new Date().toISOString(),
      files: resolvedFiles,
    });

    const { additions, deletions } = this.resolveDiffCounts(r, resolvedFiles);

    emitService.emit({
      kind: 'code_edit_proposal',
      proposalId,
      agentName,
      description: r.description as string,
      filesChanged: resolvedFiles.length,
      additions,
      deletions,
      warnings: r.warnings as string[],
      files: resolvedFiles,
    });
  }

  private resolveAgentIdentity(ctx: ExecutionContext): { agentId: string; agentName: string } {
    const agentId = ctx.agent?.id ?? ctx.agentId ?? 'unknown-agent';
    const agentName = ctx.agent?.name ?? ctx.agentId ?? 'unknown-agent';
    return { agentId, agentName };
  }

  private resolveProposalStore(): IProposalStore {
    const store = this.proposalStoreFactory.create(this.workspaceRoot) as IProposalStore;
    return store;
  }

  private async resolveProposalFiles(
    changes: Array<{ filePath: string; oldContent: string; newContent: string }>
  ): Promise<Array<{ filePath: string; oldContent: string; newContent: string }>> {
    const resolvedFiles: typeof changes = [];
    for (const change of changes) {
      const absPath = path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(this.workspaceRoot, change.filePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, change.newContent, 'utf8');
      resolvedFiles.push({
        filePath: absPath,
        oldContent: change.oldContent,
        newContent: change.newContent,
      });
    }
    return resolvedFiles;
  }

  private resolveDiffCounts(
    payload: Record<string, unknown>,
    files: Array<{ oldContent: string; newContent: string }>
  ): { additions: number; deletions: number } {
    let additions = typeof payload.additions === 'number' ? payload.additions : 0;
    let deletions = typeof payload.deletions === 'number' ? payload.deletions : 0;
    if (additions === 0 && deletions === 0) {
      for (const f of files) {
        const counts = this.countLineDiffs(f.oldContent ?? '', f.newContent ?? '');
        additions += counts.additions;
        deletions += counts.deletions;
      }
    }
    return { additions, deletions };
  }

  private countLineDiffs(
    oldContent: string,
    newContent: string
  ): { additions: number; deletions: number } {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const maxLen = Math.max(oldLines.length, newLines.length);
    let additions = 0;
    let deletions = 0;

    for (let i = 0; i < maxLen; i++) {
      if (i >= oldLines.length) {
        additions++;
        continue;
      }
      if (i >= newLines.length) {
        deletions++;
        continue;
      }
      if (oldLines[i] !== newLines[i]) {
        additions++;
        deletions++;
      }
    }

    return { additions, deletions };
  }

  private isAccessEnvelope(v: unknown): v is FsPathAccessEnvelope {
    return !!v && typeof v === 'object' && 'allowed' in v && 'alternativeContexts' in v;
  }

  private extractAlternativeContexts(
    payload: Record<string, unknown>
  ): Array<{ contextId: string; allowedPaths: string[] }> {
    const direct = payload.alternativeContexts;
    const access = payload.access;
    const accessAlternatives = this.isAccessEnvelope(access)
      ? access.alternativeContexts
      : undefined;

    const candidates = [direct, accessAlternatives];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      return candidate
        .filter(
          (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
        )
        .map((item) => ({
          contextId: typeof item.contextId === 'string' ? item.contextId : '',
          allowedPaths: Array.isArray(item.allowedPaths)
            ? item.allowedPaths.filter((p): p is string => typeof p === 'string')
            : [],
        }))
        .filter((item) => item.contextId.length > 0);
    }

    return [];
  }

  private extractBlockedPaths(payload: Record<string, unknown>): string[] {
    const blockedFiles = payload.blockedFiles;
    if (!Array.isArray(blockedFiles)) return [];

    return blockedFiles
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => (typeof item.filePath === 'string' ? item.filePath : ''))
      .filter((p) => p.length > 0);
  }

  private getLatestHumanMessageText(ctx: ExecutionContext): string {
    for (let i = ctx.history.length - 1; i >= 0; i -= 1) {
      const msg = ctx.history[i];
      if (msg.isHuman || msg.from === 'human') {
        return msg.content || '';
      }
    }
    return '';
  }

  private parseToolHistoryIntent(input: string): ToolHistoryIntent {
    const intent: ToolHistoryIntent = {};

    if (/\b(summarize|summary|most important|key points|tldr|tl;dr)\b/i.test(input)) {
      intent.mode = 'summary';
    }
    if (/\b(analyze|analysis|implications|risks|action items|next steps)\b/i.test(input)) {
      intent.mode = 'analysis';
    }

    const lineRange = /lines?\s+(\d+)\s*[-:]\s*(\d+)/i.exec(input);
    if (lineRange) {
      intent.lineStart = Number(lineRange[1]);
      intent.lineEnd = Number(lineRange[2]);
    }

    const firstLines = /first\s+(\d+)\s+lines?/i.exec(input);
    if (firstLines) intent.firstLines = Number(firstLines[1]);

    const lastLines = /last\s+(\d+)\s+lines?/i.exec(input);
    if (lastLines) intent.lastLines = Number(lastLines[1]);

    const maxChars = /(?:max|limit)\s+(\d+)\s*(?:chars?|characters?)/i.exec(input);
    if (maxChars) intent.maxChars = Number(maxChars[1]);

    const regexLiteral = /regex\s*[:=]\s*\/(.+)\/([gimsuy]*)/i.exec(input);
    if (regexLiteral) {
      intent.regex = regexLiteral[1];
      intent.regexFlags = regexLiteral[2] || 'i';
    } else {
      const regexLoose = /regex\s*[:=]\s*([^\n]+)/i.exec(input);
      if (regexLoose) {
        intent.regex = regexLoose[1].trim();
        intent.regexFlags = 'i';
      }
    }

    const quotedSearch = /search(?:\s+for)?\s+"([^"]+)"/i.exec(input);
    if (quotedSearch) {
      intent.search = quotedSearch[1];
    } else {
      const bareSearch = /search(?:\s+for)?\s+([^\n]+)/i.exec(input);
      if (bareSearch) intent.search = bareSearch[1].trim();
    }

    return intent;
  }

  private applyDeterministicFilters(
    output: string,
    intent: ToolHistoryIntent
  ): { output: string; changed: boolean; label: string } {
    const defaultMaxLines = 120;
    const defaultMaxChars = 6000;
    const largeOutputChars = 8000;
    const largeOutputLines = 200;

    let text = output.replaceAll(/\r\n?/g, '\n');
    const labels: string[] = [];
    const original = text;
    const jsonDocument = this.serialization.isLikelyJsonDocument(original);

    if (intent.search) {
      const needle = intent.search.toLowerCase();
      text = text
        .split('\n')
        .filter((line) => line.toLowerCase().includes(needle))
        .join('\n');
      labels.push('search');
    }

    if (intent.regex) {
      try {
        const re = new RegExp(intent.regex, intent.regexFlags || 'i');
        text = text
          .split('\n')
          .filter((line) => re.test(line))
          .join('\n');
        labels.push('regex');
      } catch {
        labels.push('regex-invalid');
      }
    }

    let lines = text.split('\n');
    const lineFilter = this.applyLineWindow(lines, intent);
    lines = lineFilter.lines;
    if (lineFilter.label) labels.push(lineFilter.label);

    const isLarge = lines.length > largeOutputLines || original.length > largeOutputChars;
    if (!jsonDocument && isLarge && lines.length > defaultMaxLines) {
      lines = lines.slice(0, defaultMaxLines);
      labels.push('auto-max-lines');
    }

    text = lines.join('\n');

    const maxChars = intent.maxChars ?? (!jsonDocument && isLarge ? defaultMaxChars : undefined);
    if (maxChars !== undefined && text.length > maxChars) {
      text = `${text.slice(0, maxChars)}\n…[history-truncated at ${maxChars} chars]`;
      labels.push(intent.maxChars ? 'max-chars' : 'auto-max-chars');
    }

    const changed = text !== original;
    return {
      output: changed ? text : output,
      changed,
      label: labels.length > 0 ? labels.join(',') : 'none',
    };
  }

  private applyLineWindow(
    lines: string[],
    intent: ToolHistoryIntent
  ): { lines: string[]; label?: string } {
    if (intent.lineStart !== undefined && intent.lineEnd !== undefined) {
      const start = Math.max(1, Math.min(intent.lineStart, lines.length || 1));
      const end = Math.max(start, Math.min(intent.lineEnd, lines.length || start));
      return {
        lines: lines.slice(start - 1, end),
        label: 'line-range',
      };
    }

    if (intent.firstLines !== undefined) {
      return {
        lines: lines.slice(0, Math.max(1, intent.firstLines)),
        label: 'first-lines',
      };
    }

    if (intent.lastLines !== undefined) {
      return {
        lines: lines.slice(Math.max(0, lines.length - Math.max(1, intent.lastLines))),
        label: 'last-lines',
      };
    }

    return { lines };
  }

  private async applyLlmTransform(
    toolName: string,
    input: string,
    mode: 'summary' | 'analysis'
  ): Promise<string | undefined> {
    if (!input.trim()) return input;

    const clipped = input.length > 20_000 ? `${input.slice(0, 20_000)}\n...[input clipped]` : input;
    const systemPrompt =
      mode === 'summary'
        ? 'Summarize tool output faithfully and concisely. Keep key facts, counts, errors, and URLs. Do not invent details. Max 12 bullets.'
        : 'Analyze tool output concisely. Return: key findings, risks/issues, and actionable next steps. Do not invent details.';

    try {
      const transformed = await this.llmService.rawChat(
        systemPrompt,
        [{ role: 'user', content: `Tool: ${toolName}\n\n${clipped}` }],
        { maxTokens: 450, temperature: 0.1 }
      );
      return transformed.trim();
    } catch {
      return undefined;
    }
  }
}
