---
applyTo: ".ai-team/agents/**/*.agent.md"
---

# ai-team agent frontmatter authoring

Write ai-team agent YAML frontmatter the ai-team way.

## Purpose

- All agent metadata lives in the YAML frontmatter of the `.agent.md` file.
- There is no separate `.agent.yml` sidecar. One file per agent.
- Do **not** duplicate long narrative portfolio text in frontmatter.

## What belongs in frontmatter

- identity and organization fields such as:
  - `name`
  - `role`, `type`, `contextLevel`
  - `reportsTo`, `specializations`
- discovery fields:
  - `description`
- ai-team runtime persona/config fields when needed:
  - `personality`, `avatar`, `goal`, `backstory`
  - `capabilities`, `availableFor`
- operational fields:
  - `tools`
  - `cliTools`
  - `canDelegate`, `delegatesTo`
  - `memory`, `maxIterations`
  - `llm`
- Copilot-native fields:
  - `handoffs`
  - `customInstructions`, `roleDefinition`, `instructions`
  - `model`, `modelFamily`

## specializations (skill assignments)

- `specializations` is a list of skill IDs that map directly to files under `.ai-team/skills/<id>/SKILL.md`.
- These skills are loaded dynamically when the agent is active; keep the list narrow and real.
- Use the folder name under `.ai-team/skills/` as the ID (e.g., `workspace-file-system-abstraction`).
- Do **not** put arbitrary topic tags or responsibility labels here — those belong in the "Scope of Responsibility" section of the Markdown body.

## Path-access location (important)

- Do **not** store file-path read/write/create/delete globs in frontmatter.
- Per-agent file-system access now lives in `.ai-team/agents/<agent-id>.perm`.
- Keep frontmatter focused on identity, org structure, tools, delegation, and related metadata.

## Rules

- Use only schema-backed fields from `packages/core/src/types/index.ts`.
- Every non-CEO agent should have an explicit `reportsTo`.
- Prefer real ai-team runtime tool names over decorative or imaginary ones.
- Keep frontmatter as small as possible while still letting the agent do its real job.
- If a field only helps human readability, prefer keeping it in the Markdown body instead.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good `.agent.md` frontmatter block is operationally complete, schema-valid, minimal, and complements the Markdown body below it.