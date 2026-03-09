---
applyTo: ".ai-team/agents/**/*.agent.yml,.ai-team/agents/**/*.agent.yaml"
---

# ai-team agent metadata authoring

Write ai-team runtime agent metadata sidecars the ai-team way.

## Purpose

- `.agent.yml` is the ai-team runtime metadata file for an agent.
- Keep runtime-specific fields here so the sibling `.agent.md` can stay focused on Copilot discovery, personality, and human-readable portfolio content.
- Do **not** duplicate long narrative portfolio text in the metadata sidecar.

## What belongs here

- identity and organization fields such as:
  - `id`, `name`
  - `role`, `type`, `contextLevel`
  - `reportsTo`, `specializations`, `features`
- ai-team runtime persona/config fields when needed:
  - `personality`, `avatar`, `goal`, `backstory`
  - `capabilities`, `skills`, `availableFor`
- operational fields:
  - `permissions`
  - `tools`
  - `cliTools`
  - `canDelegate`, `delegatesTo`
  - `memory`, `maxIterations`
  - `llm`

## Rules

- Use only schema-backed fields from `packages/core/src/types/index.ts`.
- Prefer `id` and `name` as the normal identity fields for ai-team metadata files.
- Treat `aiTeamId` and `aiTeamName` as legacy compatibility aliases rather than the preferred naming.
- Every non-CEO agent should have an explicit `reportsTo`.
- Prefer real ai-team runtime tool names over decorative or imaginary ones.
- Keep permissions as small as possible while still letting the agent do its real job.
- If a field only helps Copilot discovery or human readability, prefer keeping it in `.agent.md` instead.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good `.agent.yml` file is operationally complete, schema-valid, minimal, and clearly separated from the sibling Markdown portfolio.