# Memory (Short-Term and Long-Term)

**Memory** in ai-team is everything that persists beyond a single LLM call: summaries, logs, decisions, and knowledge that agents can reuse later.

## 1. Types of Memory

- **Short-term (working memory)**
  - Task summaries, current goals, recent decisions.
  - Small, frequently updated, optimized for being sent to the model.
- **Long-term (knowledge)**
  - Architecture decisions, rules, incident reports, docs.
  - Lives in markdown/JSON files and is accessed via search.
- **Transcripts and traces**
  - Raw logs of chats, tool calls, and LLM prompts/responses.
  - Kept for debugging, evaluation, and audits; not fed back wholesale.

## 2. Storage in ai-team

- Working memory per task lives in small files under `.ai-team/tasks/` or similar.
- Long-term knowledge lives in:
  - `requirements/` (specs, analysis).
  - `docs/` (architecture, API docs).
  - `.ai-team/knowledge/` (team-specific notes).
- Transcripts and traces are stored as JSONL in `.ai-team/logs/`.

## 3. Maintenance

- Working memory is regenerated periodically from recent turns + previous summary.
- Logs may be rotated or pruned according to retention policies.
- Knowledge files are human-maintained (PRs, reviews) so they remain high-quality.

## 4. Design Principles

- **Explicit over implicit:** no hidden long-term model memory; everything is in files.
- **Least retention:** keep only what is useful and safe to store.
- **Traceability:** link summaries back to source files or conversations when possible.

## Further Reading

- OpenAI – Memory concepts: https://platform.openai.com/docs/guides/memory
- Microsoft – AI memory patterns: https://learn.microsoft.com/azure/ai-concepts/ai-memory-patterns
- MemGPT paper and implementations (virtual context management): https://arxiv.org/abs/2310.08560
