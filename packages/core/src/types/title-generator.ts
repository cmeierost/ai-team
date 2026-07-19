/**
 * Title generation and summarization service.
 *
 * Responsible for generating session titles from message content,
 * propagating titles across thread chains, and providing general
 * text summarization capabilities.
 */
export interface ITitleGenerator {
  /**
   * Generate a title for a session using LLM.
   * Reads messages and generates a descriptive title.
   */
  generateTitle(sessionId: string, llmService: unknown): Promise<string>;

  /**
   * Set a title on all sessions in a thread chain.
   */
  setThreadTitle(sessionId: string, title: string): Promise<void>;

  /**
   * Summarize arbitrary text for context compression.
   */
  summarizeForContextAsync(
    sourceText: string,
    maxWords?: number,
    focusInstruction?: string
  ): Promise<string>;
  summarizeForContextAsync(
    llmService: unknown,
    sourceText: string,
    maxWords?: number,
    focusInstruction?: string
  ): Promise<string>;
}
