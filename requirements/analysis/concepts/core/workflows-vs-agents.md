# Workflows vs Agents

ai-team distinguishes between **workflows** and **agents** to keep behavior predictable and testable.

## 1. Workflows

Workflows are **deterministic sequences of steps**. Examples:

- Initialize a new project.
- Run all tests and collect results.
- Regenerate documentation from source files.

Characteristics:

- Steps and order are known in advance.
- Each step calls tools or core functions directly (no open-ended reasoning).
- Easy to test and run in CI.

In this repo, workflows are typically implemented:

- In CLI commands under `packages/cli`.
- In VS Code commands that call into `@ai-team/core`.

## 2. Agents

Agents are **dynamic loops**: they decide what to do next based on current context and tool results.

- Suitable for fuzzy tasks (refactors, debugging, design questions).
- Use planning plus tool calls to reach a goal.
- Must be bounded by limits (iterations, tokens, time).

## 3. How They Interact

- Many workflows **contain** one or more agent steps:
  - Example: a workflow runs tests, then hands a failing test to a debugging agent.
- Agents may launch small internal workflows for routine tasks.

## 4. Design Guidance

- Prefer workflows where the process is known and repeatable.
- Use agents only when flexibility and reasoning are required.
- Keep the boundary explicit so humans know what is deterministic and what is model-driven.

## Further Reading

- Microsoft – Agent patterns and planning: https://learn.microsoft.com/azure/ai-concepts/ai-agents-patterns
- LlamaIndex – Workflows and agent workflows (conceptual docs): https://docs.llamaindex.ai/en/stable/
- Haystack – Pipelines and agents overview: https://docs.haystack.deepset.ai
