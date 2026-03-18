/**
 * Introduction module — deterministic agent greetings for new chat sessions.
 * Extracted from commands/chat.ts to keep the command thin.
 */

import {
  parseMarkdownSections,
  type Agent,
  type AgentManager,
  type ChatMessage,
  type Skill,
  type LlmService,
} from '@ai-team/core';
import type { SessionManager } from '../session-manager.js';
import type { ChatRuntimeHooks } from '../contracts.js';

const DEFAULT_GREETING_TEMPLATE = 'Hi {{developerName}}, I\'m {{agentName}} ({{agentRole}}). How can I help today?';

function resolveGreetingTemplate(agent: Agent): string {
  const markdown = agent.markdown?.trim();
  if (!markdown) return DEFAULT_GREETING_TEMPLATE;

  const sections = parseMarkdownSections(markdown);
  const greetingSection = sections.find((section) => {
    const heading = section.heading.trim().toLowerCase();
    return heading === 'greeting'
      || heading === 'greeting template'
      || heading === 'welcome';
  });

  if (greetingSection?.content?.trim()) {
    return greetingSection.content.trim();
  }

  return DEFAULT_GREETING_TEMPLATE;
}

function renderGreetingTemplate(
  template: string,
  agent: Agent,
  developerName: string | undefined,
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
  _llm: LlmService,
  _agentManager: AgentManager,
  agent: Agent,
  _skill: Skill | undefined,
  developerName: string | undefined,
  _signal?: AbortSignal,
  _onChunk?: (delta: string) => void,
): Promise<string> {
  const template = resolveGreetingTemplate(agent);
  return renderGreetingTemplate(template, agent, developerName);
}

/**
 * Best-effort introduction: prints the agent's greeting to stdout and appends it to history.
 * This path is deterministic and does not call the LLM.
 */
export interface TryIntroduceUserRequest {
  llm: LlmService;
  agentManager: AgentManager;
  agent: Agent;
  history: ChatMessage[];
  skill: Skill | undefined;
  developerName: string | undefined;
  sessionManager: SessionManager;
  sessionId: string;
  hooks: ChatRuntimeHooks;
}

export async function tryIntroduceUser(request: TryIntroduceUserRequest): Promise<void> {
  const {
    llm,
    agentManager,
    agent,
    history,
    skill,
    developerName,
    sessionManager,
    sessionId,
    hooks,
  } = request;

  if (!hooks.emit) {
    process.stdout.write(`\n${agent.name} (${agent.role}): `);
  }

  const text = await generateIntroduction(
    llm,
    agentManager,
    agent,
    skill,
    developerName,
    hooks.signal,
  );

  if (hooks.emit) {
    hooks.emit({ kind: 'token', text: `${text}\n\n` });
  } else {
    process.stdout.write(`${text}\n\n`);
  }

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    to: 'human',
    content: text,
    importance: 'low',
  };
  await sessionManager.appendMessage(sessionId, agentMsg);
  history.push(agentMsg);
  await agentManager.recordInteraction(agent.id);
}
