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

import type { ChatCompletionMessageParam, ChatMessage } from '@ai-team/infrastructure';
import { LlmService } from '@ai-team/infrastructure';
import type { IContextBuilder } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class DefaultContextBuilder implements IContextBuilder {
  async build(history: ChatMessage[], ctx: OrchestratorContext): Promise<ChatCompletionMessageParam[]> {
    return LlmService.historyToMessages(history, ctx.agent.id);
  }
}
