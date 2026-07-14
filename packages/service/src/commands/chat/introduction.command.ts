import type {
  Agent,
  ChatMessage,
  IAgentManager,
  IEmitService,
  IMarkdownSectionService,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

const DEFAULT_GREETING_TEMPLATE =
  "Hi {{developerName}}, I'm {{agentName}} ({{agentRole}}). How can I help today?";

export interface IntroductionCommandInput {
  agent: Agent;
  history: ChatMessage[];
  developerName?: string;
  sessionId: string;
}

export class IntroductionRenderer {
  constructor(private readonly markdownSectionService: IMarkdownSectionService) {}

  render(agent: Agent, developerName: string | undefined): string {
    const template = this.resolveGreetingTemplate(agent);
    return this.renderGreetingTemplate(template, agent, developerName);
  }

  private resolveGreetingTemplate(agent: Agent): string {
    const markdown = agent.markdown?.trim();
    if (!markdown) return DEFAULT_GREETING_TEMPLATE;

    const sections = this.markdownSectionService.parseMarkdownSections(markdown);
    const greetingSection = sections.find((section) => {
      const heading = section.heading.trim().toLowerCase();
      return heading === 'greeting' || heading === 'greeting template' || heading === 'welcome';
    });

    if (greetingSection?.content?.trim()) {
      return greetingSection.content.trim();
    }

    return DEFAULT_GREETING_TEMPLATE;
  }

  private renderGreetingTemplate(
    template: string,
    agent: Agent,
    developerName: string | undefined
  ): string {
    const safeDeveloper = developerName?.trim() || 'there';

    return template
      .replaceAll(/\{\{\s*developerName\s*\}\}/gi, safeDeveloper)
      .replaceAll(/\{\{\s*developer\s*\}\}/gi, safeDeveloper)
      .replaceAll(/\{\{\s*agentName\s*\}\}/gi, agent.name)
      .replaceAll(/\{\{\s*agentRole\s*\}\}/gi, agent.role)
      .trim();
  }
}

export class IntroductionCommand {
  private readonly renderer: IntroductionRenderer;

  constructor(
    private readonly agentManager: Pick<IAgentManager, 'recordInteractionAsync'>,
    private readonly markdownSectionService: IMarkdownSectionService,
    private readonly sessionManager: Pick<SessionManager, 'appendMessage'>,
    private readonly emitService: IEmitService
  ) {
    this.renderer = new IntroductionRenderer(this.markdownSectionService);
  }

  async execute(input: IntroductionCommandInput): Promise<void> {
    // Emit agent name prefix
    this.emitService.token(`\n${input.agent.name} (${input.agent.role}): `);

    const text = this.renderer.render(input.agent, input.developerName);
    this.emitService.token(`${text}\n\n`);

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: input.agent.id,
      to: 'human',
      content: text,
      importance: 'low',
    };
    await this.sessionManager.appendMessage(input.sessionId, agentMsg);
    input.history.push(agentMsg);
    await this.agentManager.recordInteractionAsync(input.agent.id);
  }
}
