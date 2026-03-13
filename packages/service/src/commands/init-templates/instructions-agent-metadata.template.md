---
applyTo: ".ai-team/agents/**/*.agent.yml,.ai-team/agents/**/*.agent.yaml"
---

# ai-team agent metadata authoring

Write ai-team runtime agent metadata sidecars the ai-team way.

## Purpose

- `.agent.yml` is the ai-team runtime metadata file for an agent.
- Keep runtime-specific fields here so the sibling `.agent.md` can stay focused on Copilot discovery, personality, and human-readable portfolio content.

## What belongs here

- identity and organization fields such as:
  - `id`, `name`
  - `role`, `type`, `contextLevel`
  - `reportsTo`, `specializations`, `features`
- operational fields:
  - `permissions`
  - `tools`
  - `cliTools`
  - `canDelegate`, `delegatesTo`
  - `llm`

## Rules

- Use only schema-backed fields from `packages/core/src/types/index.ts` when that file exists in the repository.
- Prefer `id` and `name` as the normal identity fields.
- Every non-CEO agent should have an explicit `reportsTo`.
- Keep permissions as small as possible while still letting the agent do its real job.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good `.agent.yml` file is operationally complete, schema-valid, minimal, and clearly separated from the sibling Markdown portfolio.
