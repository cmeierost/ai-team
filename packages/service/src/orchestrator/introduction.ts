/**
 * Introduction module — generates agent greetings for new chat sessions.
 * Extracted from commands/chat.ts to keep the command thin.
 */

import type { Agent, AgentManager, ChatMessage, Skill, ChatCompletionMessageParam } from '@ai-team/core';
import { LlmService, withAbortSignal } from '@ai-team/core';
import type { SessionManager } from '../session-manager.js';
import type { ChatRuntimeHooks } from '../contracts.js';
import { extractStreamDeltaText, emitLog } from './stream-events.js';

const INTRODUCTION_TIMEOUT_MS = 12_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the LLM to introduce itself to the developer on session open.
 * Returns the full introduction text (may be empty on error).
 */
export async function generateIntroduction(
  llm: LlmService,
  agentManager: AgentManager,
  agent: Agent,
  skill: Skill | undefined,
  developerName: string | undefined,
  signal?: AbortSignal,
  onChunk?: (delta: string) => void,
): Promise<string> {
  const nameRef = developerName ? `, ${developerName}` : '';
  const prompt =
    `The developer${nameRef} just opened a chat with you. ` +
    'Introduce yourself briefly: say hi, state your name and role, and ask what you can help with. ' +
    '1–2 sentences max. Be warm but concise.';

  const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: prompt }];
  const teamRoster = agentManager.getAllAgents();

  // initializeForChat returns provider-specific options; optional — OK to call pre-stream
  const llmOptions = await llm.initializeForChat(agent, skill);
  const stream = await llm.streamChat(agent, messages, llmOptions, skill, teamRoster);

  const iterator = stream[Symbol.asyncIterator]();
  let fullText = '';

  try {
    while (true) {
      const next = await withAbortSignal(
        iterator.next(),
        signal,
        'Chat introduction aborted by user.',
      );
      if (next.done) break;
      const delta = extractStreamDeltaText(next.value);
      if (delta) {
        onChunk?.(delta);
        fullText += delta;
      }
    }
  } finally {
    await iterator.return?.();
  }

  return fullText.trim();
}

/**
 * Best-effort introduction: prints the agent's greeting to stdout and appends it to history.
 * If the LLM is slow or unavailable, issues a warning and returns without introducing.
 */
export async function tryIntroduceUser(
  llm: LlmService,
  agentManager: AgentManager,
  agent: Agent,
  history: ChatMessage[],
  skill: Skill | undefined,
  developerName: string | undefined,
  sessionManager: SessionManager,
  sessionId: string,
  hooks: ChatRuntimeHooks,
): Promise<void> {
  const isAbort = (e: unknown) =>
    /aborted|abort/i.test(e instanceof Error ? e.message : String(e));

  try {
    await withAbortSignal(
      withTimeout(
        doIntroduce(),
        INTRODUCTION_TIMEOUT_MS,
        `Introduction timed out after ${INTRODUCTION_TIMEOUT_MS / 1000}s.`,
      ),
      hooks.signal,
      'Chat introduction aborted by user.',
    );
  } catch (err) {
    if (isAbort(err)) throw err;
    emitLog(hooks, 'warn', 'Introduction skipped. You can start typing now.');
  }

  async function doIntroduce(): Promise<void> {
    if (!hooks.emit) process.stdout.write(`\n${agent.name} (${agent.role}): `);

    let text: string;
    try {
      text = await generateIntroduction(
        llm,
        agentManager,
        agent,
        skill,
        developerName,
        hooks.signal,
        delta => {
          if (hooks.emit) {
            hooks.emit({ kind: 'token', text: delta });
          } else {
            process.stdout.write(delta);
          }
        },
      );
    } catch (err) {
      if (!hooks.emit) process.stdout.write('\n\n');
      if (isAbort(err)) throw err;
      emitLog(hooks, 'error', `LLM unavailable: ${err instanceof Error ? err.message : String(err)}`);
      emitLog(hooks, 'info', 'Introduction skipped. You can continue once the LLM is reachable.');
      return;
    }

    if (!hooks.emit) process.stdout.write('\n\n');

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      content: text,
      importance: 'low',
    };
    await sessionManager.appendMessage(sessionId, agentMsg);
    history.push(agentMsg);
    await agentManager.recordInteraction(agent.id);
  }
}
