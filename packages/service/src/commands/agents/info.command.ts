import type {
  ICommand,
  IAgentManager,
  ILlmService,
  IEmitService,
  ExecutionContext,
  CommandResponse,
  Agent,
  ICommandDescriptor,
} from '@ai-team/core';
import { selectDefaultTopAgent } from '../../utils/agent-selection.js';
import type { IQuestionService } from '../../questions/question-service.js';

interface ResolvedLlm {
  model?: string;
  provider?: string;
  providerName?: string;
}

function formatActiveModelLine(resolvedLlm: ResolvedLlm): string {
  if (!resolvedLlm.model) return '';
  const hint = resolvedLlm.providerName ?? resolvedLlm.provider;
  if (hint) return `  Active Model: ${resolvedLlm.model} (${hint})`;
  return `  Active Model: ${resolvedLlm.model}`;
}

function agentLlmLines(agent: Agent, resolvedLlm?: ResolvedLlm): string[] {
  const lines: string[] = [];
  if (agent.llm?.provider) lines.push(`  LLM Provider: ${agent.llm.provider}`);
  if (agent.llm?.modelKey) lines.push(`  LLM ModelKey: ${agent.llm.modelKey}`);
  if (agent.llm?.model) lines.push(`  LLM Model:    ${agent.llm.model}`);
  if (resolvedLlm) lines.push(formatActiveModelLine(resolvedLlm));
  return lines;
}

function agentProfileLines(agent: Agent, resolvedLlm?: ResolvedLlm): string[] {
  return [
    `\n  ${agent.name} (${agent.role})\n`,
    `  ID:           ${agent.id}`,
    `  Role:         ${agent.role}`,
    agent.type ? `  Type:         ${agent.type}` : '',
    agent.contextLevel ? `  Context:      ${agent.contextLevel}` : '',
    agent.reportsTo ? `  Reports to:   ${agent.reportsTo}` : '',
    agent.specializations?.length ? `  Specializations: ${agent.specializations.join(', ')}` : '',
    agent.personality?.communication_style
      ? `  Style:        ${agent.personality.communication_style}`
      : '',
    agent.personality?.expertise_level
      ? `  Expertise:    ${agent.personality.expertise_level}`
      : '',
    ...agentLlmLines(agent, resolvedLlm),
    agent.createdAt ? `  Created:      ${new Date(agent.createdAt).toLocaleDateString()}` : '',
    agent.lastInteraction
      ? `  Last active:  ${new Date(agent.lastInteraction).toLocaleDateString()}`
      : '',
    agent.conversationCount ? `  Messages:     ${agent.conversationCount}` : '',
    agent.markdown?.trim()
      ? `\n  --- Bio ---\n${agent.markdown
          .trim()
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')}`
      : '',
    `\n  File: ${agent.filePath}`,
    '',
  ];
}

function formatAgentProfile(agent: Agent, resolvedLlm?: ResolvedLlm): string {
  return agentProfileLines(agent, resolvedLlm)
    .filter((l) => l !== '')
    .join('\n');
}

export const InfoChatCommandMetadata = {
  key: 'info',
  usage: 'info [agent]',
  description: 'Get agent info (self when no argument, or named agent)',
  availableIn: { chat: true, tool: true, cli: true },
  group: 'chat',
} satisfies ICommandDescriptor;

export class InfoChatCommand implements ICommand<string, Agent[]> {
  readonly metadata = InfoChatCommandMetadata;

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly questionService: IQuestionService,
    private readonly emitService: IEmitService,
    private readonly llmService?: ILlmService
  ) {}

  private async resolveActiveLlm(agent: Agent): Promise<ResolvedLlm | undefined> {
    if (!this.llmService) return undefined;
    try {
      await this.llmService.initializeForChat(agent);
      return {
        model: this.llmService.modelName,
        provider: this.llmService.provider,
        providerName: this.llmService.providerName,
      };
    } catch {
      return undefined;
    }
  }

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<Agent[]>> {
    const query = args.trim();
    if (!query) {
      if (ctx.agent) {
        const resolvedLlm = await this.resolveActiveLlm(ctx.agent);
        return {
          status: 'ok',
          message: formatAgentProfile(ctx.agent, resolvedLlm),
          data: [ctx.agent],
        };
      }
      const all = await this.agentManager.getAllAgentsAsync();
      const resolved = selectDefaultTopAgent(all);
      if (!resolved) {
        return {
          status: 'error',
          message: 'No agents found in this workspace. Run ait init to initialize your team.',
        };
      }
      this.emitService.log(
        'info',
        `No agent specified; defaulting to ${resolved.name} (${resolved.role}).`
      );
      const resolvedLlm = await this.resolveActiveLlm(resolved);
      return {
        status: 'ok',
        message: formatAgentProfile(resolved, resolvedLlm),
        data: [resolved],
      };
    }

    const agents = await this.agentManager.resolveAgentAsync(query);
    if (agents.length === 0) {
      const all = await this.agentManager.getAllAgentsAsync();
      const agentLines = all.map((a) => `  - ${a.name} (${a.role}) [id: ${a.id}]`).join('\n');
      const agentList =
        all.length > 0
          ? `\n\nAvailable agents:\n${agentLines}\n\nRun ait list to see all agents.`
          : '';
      return { status: 'error', message: `Agent not found: "${query}"${agentList}` };
    }

    if (agents.length === 1) {
      const resolvedLlm = await this.resolveActiveLlm(agents[0]);
      return {
        status: 'ok',
        message: formatAgentProfile(agents[0], resolvedLlm),
        data: agents,
      };
    }

    const chosen = await this.questionService.select({
      message: `Multiple agents match "${query}". Which one?`,
      choices: agents.map((a) => ({ name: `${a.name} — ${a.role} [${a.id}]`, value: a.id })),
    });
    const selected = await this.agentManager.getAgentAsync(chosen);
    if (!selected) {
      return { status: 'error', message: 'Could not resolve selected agent.' };
    }
    const resolvedLlm = await this.resolveActiveLlm(selected);
    return {
      status: 'ok',
      message: formatAgentProfile(selected, resolvedLlm),
      data: [selected],
    };
  }
}
