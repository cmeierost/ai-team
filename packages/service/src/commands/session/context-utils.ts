import type { ILlmService, ChatMessage } from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

/** A persisted ChatMessage that carries a storage-assigned numeric id. */
export type StoredMessage = ChatMessage & { id?: number };

export interface ParsedContextArgs {
  messageId: number | undefined;
  /** Present when `--summarized` flag was supplied (empty string = flag with no value). */
  summarizedInstruction: string | undefined;
  /** Value from `--instruction <text>`. */
  summarizeInstruction: string | undefined;
  positional: string[];
}

/**
 * Tokenise a context sub-command arg string and extract known flags.
 * Throws a descriptive Error when a flag is malformed.
 */
export function parseContextArgs(args: string): ParsedContextArgs {
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match = tokenRegex.exec(args);
  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
    match = tokenRegex.exec(args);
  }

  let messageId: number | undefined;
  let summarizedInstruction: string | undefined;
  let summarizeInstruction: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--message') {
      const next = tokens[i + 1];
      const parsed = Number.parseInt(next ?? '', 10);
      if (!Number.isFinite(parsed)) {
        throw new Error('Invalid --message value. Provide a numeric message id.');
      }
      messageId = parsed;
      i += 1;
    } else if (token === '--summarized') {
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        summarizedInstruction = next;
        i += 1;
      } else {
        summarizedInstruction = '';
      }
    } else if (token === '--instruction') {
      const next = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Missing value for --instruction.');
      }
      summarizeInstruction = next;
      i += 1;
    } else {
      positional.push(token);
    }
  }

  return { messageId, summarizedInstruction, summarizeInstruction, positional };
}

/**
 * Summarise a stored message (or its latest tool-call result) and persist
 * the summary back through the session manager.
 *
 * Returns the trimmed summary string.
 */
export async function summarizeMessage(
  target: StoredMessage & { id: number },
  sessionManager: Pick<
    SessionManager,
    'summarizeForContextAsync' | 'updateToolCallLlmResult' | 'updateMessageContent'
  >,
  llmService: ILlmService,
  instruction: string | undefined
): Promise<string> {
  const toolCall = [...(target.tool_calls ?? [])].reverse().find((tc) => tc.id != null);

  const sourceText = toolCall
    ? (toolCall.resultLlm ??
      (toolCall.result != null ? JSON.stringify(toolCall.result, null, 2) : target.content))
    : target.content;

  const clipped =
    sourceText.length > 24_000 ? `${sourceText.slice(0, 24_000)}\n...[clipped]` : sourceText;

  const summary = await sessionManager.summarizeForContextAsync(
    llmService,
    clipped,
    200,
    instruction?.trim() || undefined
  );

  if (toolCall?.id != null) {
    await sessionManager.updateToolCallLlmResult(toolCall.id, summary.trim());
  } else {
    await sessionManager.updateMessageContent(target.id, summary.trim());
  }

  return summary.trim();
}
