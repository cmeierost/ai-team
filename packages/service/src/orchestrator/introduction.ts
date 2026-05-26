/**
 * Introduction module — deterministic agent greetings for new chat sessions.
 * Extracted from commands/chat.ts to keep the command thin.
 */

import {
  type Agent,
  type IAgentManager,
  type ChatMessage,
  type IMarkdownSectionService,
} from '@ai-team/core';
import type { SessionManager } from '../session-manager.js';
import type { ChatRuntimeHooks } from '../commands/chat/index.js';
import type { IEmitService } from './services/emit-service.js';

const DEFAULT_GREETING_TEMPLATE =
  "Hi {{developerName}}, I'm {{agentName}} ({{agentRole}}). How can I help today?";

function resolveGreetingTemplate(
  markdownSectionService: IMarkdownSectionService,
  agent: Agent
): string {
  const markdown = agent.markdown?.trim();
  if (!markdown) return DEFAULT_GREETING_TEMPLATE;

  const sections = markdownSectionService.parseMarkdownSections(markdown);
  const greetingSection = sections.find((section) => {
    const heading = section.heading.trim().toLowerCase();
    return heading === 'greeting' || heading === 'greeting template' || heading === 'welcome';
  });

  if (greetingSection?.content?.trim()) {
    return greetingSection.content.trim();
  }

  return DEFAULT_GREETING_TEMPLATE;
}

function renderGreetingTemplate(
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

/**
 * Deterministically render an introduction from the agent markdown greeting template.
 * Supports placeholders like {{developerName}}, {{agentName}}, and {{agentRole}}.
 */
export async function generateIntroduction(
  markdownSectionService: IMarkdownSectionService,
  agent: Agent,
  developerName: string | undefined,
  _signal?: AbortSignal,
  _onChunk?: (delta: string) => void
): Promise<string> {
  const template = resolveGreetingTemplate(markdownSectionService, agent);
  return renderGreetingTemplate(template, agent, developerName);
}

/**
 * Best-effort introduction: prints the agent's greeting to stdout and appends it to history.
 * This path is deterministic and does not call the LLM.
 */
export interface TryIntroduceUserRequest {
  agentManager: IAgentManager;
  markdownSectionService: IMarkdownSectionService;
  agent: Agent;
  history: ChatMessage[];
  developerName: string | undefined;
  sessionManager: SessionManager;
  sessionId: string;
  hooks: ChatRuntimeHooks;
  emitService: IEmitService;
}

export async function tryIntroduceUser(request: TryIntroduceUserRequest): Promise<void> {
  const {
    agentManager,
    markdownSectionService,
    agent,
    history,
    developerName,
    sessionManager,
    sessionId,
    hooks,
    emitService,
  } = request;

  // In CLI mode (no web emitter), print the agent name prefix to stdout.
  if (!hooks.emitService) {
    emitService.token(`\n${agent.name} (${agent.role}): `);
  }

  const text = await generateIntroduction(
    markdownSectionService,
    agent,
    developerName,
    hooks.signal
  );

  emitService.token(`${text}\n\n`);

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    to: 'human',
    content: text,
    importance: 'low',
  };
  await sessionManager.appendMessage(sessionId, agentMsg);
  history.push(agentMsg);
  await agentManager.recordInteractionAsync(agent.id);
}
