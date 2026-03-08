# Context Management and Narrowing

**Context** is everything the model can see at a given step: instructions, code snippets, docs, tool outputs, and a bit of history. Because context windows and tokens are limited, ai-team must carefully select and compress context.

## 1. Goals

- Show the model only what is necessary for the current step.
- Keep instructions and constraints highly visible.
- Respect permissions and privacy boundaries.
- Control cost and latency via token budgets.

## 2. Sources of Context

For a given task, ai-team considers:

- Task brief (what the user or parent agent asked for).
- Agent portfolio and rules (role, style, constraints).
- Relevant files and symbols (from search/index).
- Recent tool outputs (e.g., last test run, lint results).
- Minimal working memory summary for the task.

## 3. Narrowing Pipeline

The narrowing pipeline turns all potential context into a small **ContextPack** for the model:

1. **Normalize intent** into a short structured brief.
2. **Generate candidates** within the agent’s allowed scope (open file, nearby files, search hits, imports, recently touched files).
3. **Rank chunks** (subsections of files) by relevance signals.
4. **Pack under a strict token budget**, prioritizing:
   - Rules and task summary.
   - Top-ranked chunks.
   - Only essential history.
5. **Emit a manifest** describing what was included and excluded.

## 4. Working Memory vs Full History

- Working memory is a small summary (bullets) of the current task.
- Full chat/tool history is stored as logs but not routinely sent.
- Every few turns, ai-team regenerates the summary and discards older turns from context.

This keeps prompts small, focused, and reproducible.

## 5. Implementation Notes

- The context budgeter lives in `@ai-team/core` and is independent of the IDE.
- It should expose metrics: token counts per section and which files were used.
- This makes it easy to debug and tune context selection over time.

## Further Reading

- Microsoft – Prompt engineering and context windows: https://learn.microsoft.com/azure/ai-services/openai/concepts/prompt-engineering
- OpenAI – Retrieval and context: https://platform.openai.com/docs/guides/retrieval
- Anthropic – Building dependable agents (context and tools): https://docs.anthropic.com/en/docs/build-with-claude/dependable-agents
