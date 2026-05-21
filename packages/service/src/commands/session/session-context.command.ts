import { getEffectiveContextWindow, ICommandDescriptor } from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type {
  ICommand,
  CommandResponse,
  ILlmService,
  IConfigurationStorage,
  ExecutionContext,
  Agent,
} from '@ai-team/core';

interface ModelInfo {
  modelName: string;
  contextWindowTokens: number;
}

async function resolveModelInfo(
  agent: Agent,
  workspaceRoot: string,
  llmService: ILlmService,
  configurationStorage: IConfigurationStorage
): Promise<ModelInfo | undefined> {
  try {
    await llmService.initializeForChat(agent);
    const modelName = (llmService as any).modelName as string | undefined;
    if (!modelName) return undefined;

    const teamConfig = await configurationStorage.loadEffectiveConfigAsync(workspaceRoot);
    const registry = (teamConfig as any)?.providers as
      | Record<
          string,
          { contextWindow?: number; models?: Array<{ name: string; contextWindow?: number }> }
        >
      | undefined;

    if (!registry) return undefined;

    for (const providerCfg of Object.values(registry)) {
      const w = getEffectiveContextWindow(providerCfg, modelName);
      if (w !== undefined) return { modelName, contextWindowTokens: w };
    }
  } catch {
    // model info unavailable — show estimate only
  }
  return undefined;
}
export const SessionContextChatCommandMetadata = {
  key: 'session-context',
  usage: '/session context',
  description: 'Show context window usage estimate for the current session',
  availableIn: { chat: true, tool: false },
  group: 'chat',
} satisfies ICommandDescriptor;

export class SessionContextChatCommand implements ICommand<string, string> {
  readonly metadata = SessionContextChatCommandMetadata;

  constructor(
    private readonly contextService: Pick<IContextService, 'getContextEstimate'>,
    private readonly llmService: ILlmService,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    let estimate: import('../../routers/meta-service.js').ContextEstimateResponse;
    try {
      estimate = (await this.contextService.getContextEstimate(ctx.agent!.id, {
        sessionId: ctx.sessionId,
      })) as import('../../routers/meta-service.js').ContextEstimateResponse;
    } catch (err) {
      return {
        status: 'error',
        message: `Failed to estimate context: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const modelInfo = await resolveModelInfo(
      ctx.agent!,
      ctx.workspaceRoot,
      this.llmService,
      this.configurationStorage
    );

    const kb = (n: number) => `${(n / 1000).toFixed(1)}k`;
    const pct = (part: number, total: number) => `${Math.round((part / total) * 100)}%`;

    const systemChars = estimate.segments
      .filter((x) => !['messages', 'tool_results', 'session_skills'].includes(x.key))
      .reduce((s, x) => s + x.chars, 0);
    const msgChars = estimate.messages.reduce((s, m) => s + m.chars + m.toolChars, 0);
    const skillChars = estimate.sessionSkills
      .filter((s) => !s.paused)
      .reduce((s, sk) => s + sk.chars, 0);
    const total = estimate.totalChars;

    const lines: string[] = ['\n─── Context estimate ───────────────────────────────────────'];
    lines.push(`  System prompt   ${kb(systemChars).padStart(7)}  (${pct(systemChars, total)})`);
    if (skillChars > 0) {
      lines.push(`  Session skills  ${kb(skillChars).padStart(7)}  (${pct(skillChars, total)})`);
    }
    if (msgChars > 0) {
      const toolCharsTotal = estimate.messages.reduce((s, m) => s + m.toolChars, 0);
      const msgNote = toolCharsTotal > 0 ? `  incl. ${kb(toolCharsTotal)} tool data` : '';
      lines.push(
        `  Messages        ${kb(msgChars).padStart(7)}  (${pct(msgChars, total)})${msgNote}`
      );
    }
    lines.push(
      `  ${'─'.repeat(44)}`,
      `  Total           ${kb(total).padStart(7)}  (~${Math.round(total / 4).toLocaleString()} tokens)`
    );

    if (modelInfo) {
      const usedTokens = Math.round(total / 4);
      const freeTokens = modelInfo.contextWindowTokens - usedTokens;
      const usedPct = Math.round((usedTokens / modelInfo.contextWindowTokens) * 100);
      const freePct = 100 - usedPct;
      lines.push(
        '',
        `  Model           ${modelInfo.modelName}`,
        `  Window          ${(modelInfo.contextWindowTokens / 1000).toFixed(0)}k tokens`,
        `  Used            ${(usedTokens / 1000).toFixed(1)}k  (${usedPct}%)`,
        `  Free            ${(freeTokens / 1000).toFixed(1)}k  (${freePct}%)`
      );
    }
    lines.push('──────────────────────────────────────────────────────────\n');

    const output = lines.join('\n');
    return { status: 'ok', message: output, data: output };
  }
}
