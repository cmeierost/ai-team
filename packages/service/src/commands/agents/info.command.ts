import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
  Agent,
  ICommandDescriptor,
} from '@ai-team/core';
import { selectDefaultTopAgent } from '../../utils/agent-selection.js';
import type { IQuestionService } from '../../questions/question-service.js';
export const InfoChatCommandMetadata = {
  key: 'info',
  usage: '/info [employee]',
  description: 'Get agent info (self when no argument, or named agent)',
  availableIn: { chat: true, tool: true, cli: true },
  group: 'chat',
} satisfies ICommandDescriptor;

export class InfoChatCommand implements ICommand<string, Agent[]> {
  readonly metadata = InfoChatCommandMetadata;

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<Agent[]>> {
    const query = args.trim();
    if (!query) {
      if (ctx.agent) {
        return {
          status: 'ok',
          message: `${ctx.agent.name} (${ctx.agent.role})`,
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
      ctx.emit?.({
        kind: 'log',
        level: 'info',
        message: `No agent specified; defaulting to ${resolved.name} (${resolved.role}).`,
      });
      return {
        status: 'ok',
        message: `${resolved.name} (${resolved.role})`,
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
      return {
        status: 'ok',
        message: `${agents[0].name} (${agents[0].role})`,
        data: agents,
      };
    }

    const chosen = await this.questionService.questionSelect({
      message: `Multiple agents match "${query}". Which one?`,
      choices: agents.map((a) => ({ name: `${a.name} — ${a.role} [${a.id}]`, value: a.id })),
    });
    const selected = await this.agentManager.getAgentAsync(chosen);
    if (!selected) {
      return { status: 'error', message: 'Could not resolve selected agent.' };
    }
    return {
      status: 'ok',
      message: `${selected.name} (${selected.role})`,
      data: [selected],
    };
  }
}
