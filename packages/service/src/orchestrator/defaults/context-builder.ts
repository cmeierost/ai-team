/**
 * DefaultContextBuilder — default IContextBuilder.
 *
 * Returns the chat history as OpenAI-compatible messages WITHOUT a system message.
 * The system message is added by:
 *   - LlmService.chatWithTools()  in tool mode (it builds it from agent/skill/team)
 *   - send-turn.ts manually       in streaming mode (no tools)
 *
 * This avoids duplicate system messages in the tool-call path.
 */

import type { ILlmChatMessageParam, ChatMessage } from '@ai-team/core';
import type { IContextBuilder } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

function historyToMessages(history: ChatMessage[], _agentId: string): ILlmChatMessageParam[] {
  return history
    .filter((msg) => !msg.archived && !msg.hiddenFromLlm)
    .map((msg) => ({
      role: msg.from === 'human' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));
}

export class DefaultContextBuilder implements IContextBuilder {
  async build(history: ChatMessage[], ctx: OrchestratorContext): Promise<ILlmChatMessageParam[]> {
    return historyToMessages(history, ctx.agent.id);
  }
}
