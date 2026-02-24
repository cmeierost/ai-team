# Subagents and Teams

**Subagents** are specialized agents invoked by another agent (the "parent") to handle part of a task. Together they form an **agent team**.

## 1. Why Subagents?

- Decompose large tasks into smaller, focused subtasks.
- Give each agent a smaller context and clearer responsibilities.
- Allow different agents to have different tools and permissions.

Examples:
- A Chief Architect delegates detailed refactoring to a Refactoring Engineer.
- A Test Lead agent writes tests after another agent implements a feature.

## 2. Handoff Contract

A handoff is a structured message from parent to subagent containing:

- Task description and goal.
- Relevant files or evidence (paths, symbols, snippets).
- Constraints and acceptance criteria.
- What the parent expects back (summary, patch, report).

The handoff is intentionally small: only the minimum context the subagent needs.

## 3. Implementation in ai-team

- Delegation is done via a tool such as `delegate_to_agent`.
- The tool:
  - Validates that the target agent exists.
  - Checks that the target has appropriate permissions.
  - Writes a handoff artifact (file) describing the subtask.
  - Starts a new agent loop for the subagent, scoped to that handoff.
- Results are written back into:
  - A result artifact (summary, patches, logs).
  - The parent’s working memory.

## 4. Design Guidelines

- Prefer a **small number of well-defined agents** over many overlapping ones.
- Use subagents where specialization is clear (tests, docs, refactors, infra).
- Make handoffs explicit files so humans can inspect and override when needed.

## Further Reading

- Anthropic – Orchestrating multi-agent systems: https://docs.anthropic.com/en/docs/build-with-claude/multi-agent
- OpenAI – Agents and handoffs (Agents SDK overview): https://platform.openai.com/docs/guides/agents
- Microsoft – Agent patterns and planning: https://learn.microsoft.com/azure/ai-concepts/ai-agents-patterns
