# Agents

An **agent** is an LLM-driven worker with a defined role, objectives, tools, and context. In ai-team, agents are modeled as "employees" (e.g., Chief Architect, Refactoring Engineer) that operate over multiple steps instead of a single prompt.

## 1. Responsibilities

- Interpret incoming tasks (from humans or other agents).
- Decide whether they can handle the task within their scope.
- Select and invoke tools (skills) to make progress.
- Maintain a small, evolving view of the task state (working memory).
- Stop when success criteria are met or when they must hand off.

## 2. Structure in ai-team

In this repo, each agent is represented by:

- A configuration file (e.g., `.ai-team/agents/<name>/agent.md`) with YAML frontmatter:
  - `role`, `seniority`, `responsibilities`.
  - `contextPaths` (folders/files they can see).
  - `skills` (which skill bundles they can use).
- Optional portfolio or examples in the markdown body.

Agents in `@ai-team/core` are pure data + logic:

- Types describing the agent configuration.
- Functions to:
  - Load/validate agent configs.
  - Enforce context and tool permissions.
  - Run agent loops (observe → think → act → observe).

## 3. Agent Loop (Conceptual)

High-level flow for an agent handling a task:

1. Read task brief and current working memory.
2. Decide on next action:
   - Plan (update steps).
   - Call one or more tools.
   - Delegate to another agent.
   - Ask the human for clarification.
3. Execute the action (through the tool gateway or delegation system).
4. Update working memory and logs.
5. Repeat until done or limits reached (steps, tokens, time).

This loop is always bounded by policies (max iterations, token budgets, allowed tools) so agents cannot run unbounded workflows.

## 4. Design Principles

- **Clear boundaries:** each agent has a narrow, documented scope.
- **Deterministic configuration:** behavior is driven by files in `.ai-team/`, not hard-coded logic.
- **LLM-agnostic:** the same agent definition can run on different models (GPT, Claude, etc.).

These principles keep agents predictable, auditable, and easy to extend.

## Further Reading

- OpenAI – Function calling and agents: https://platform.openai.com/docs/guides/function-calling
- Anthropic – Tool use and agents: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
- Microsoft – Agent orchestration patterns: https://learn.microsoft.com/azure/ai-concepts/ai-agents-patterns
