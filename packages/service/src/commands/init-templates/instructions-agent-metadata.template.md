---
applyTo: ".ai-team/agents/**/*.agent.md"
---

# ai-team agent frontmatter authoring

Write ai-team agent YAML frontmatter the ai-team way.

## Purpose

- All agent metadata lives in the YAML frontmatter of the `.agent.md` file.
- There is no separate `.agent.yml` sidecar. One file per agent.

## What belongs in frontmatter

- identity and organization fields such as:
  - `name`
  - `role`, `type`, `contextLevel`
  - `reportsTo`, `specializations`, `features`
- discovery fields:
  - `description`
- operational fields:
  - `tools`
  - `cliTools`
  - `canDelegate`, `delegatesTo`
  - `llm`
- Copilot-native fields:
  - `handoffs`
  - `customInstructions`, `roleDefinition`, `instructions`
  - `model`, `modelFamily`

## Rules

- Use only schema-backed fields from `packages/core/src/types/index.ts` when that file exists in the repository.
- Every non-CEO agent should have an explicit `reportsTo`.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good `.agent.md` frontmatter block is operationally complete, schema-valid, minimal, and complements the Markdown body below it.
