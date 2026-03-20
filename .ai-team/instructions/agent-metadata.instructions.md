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
  - `reportsTo`, `specializations`
- ai-team runtime persona/config fields when needed:
  - `personality`, `avatar`, `goal`, `backstory`
  - `capabilities`, `availableFor`
- operational fields:
  - `tools`
  - `cliTools`
  - `canDelegate`, `delegatesTo`
  - `memory`, `maxIterations`
  - `llm`

## specializations (skill assignments)

- `specializations` is a list of skill IDs that map directly to files under `.ai-team/skills/<id>/SKILL.md`.
- These skills are loaded dynamically when the agent is active; keep the list narrow and real.
- Use the folder name under `.ai-team/skills/` as the ID (e.g., `workspace-file-system-abstraction`).
- Do **not** put arbitrary topic tags or responsibility labels here — those belong in the "Scope of Responsibility" section of the sibling `.agent.md`.
- The human-readable description of what the agent is for and which skills it owns belongs in the `.agent.md` "Scope of Responsibility" section, not in the YAML sidecar.

## Path-access location (important)

- Do **not** store file-path read/write/create/delete globs in `.agent.yml`.
- Per-agent file-system access now lives in `.ai-team/agents/<agent-id>.access`.
- Keep `.agent.yml` focused on runtime identity, org structure, tools, delegation, and related metadata.

## Rules

- Use only schema-backed fields from `packages/core/src/types/index.ts`.
- Prefer `id` and `name` as the normal identity fields for ai-team metadata files.
- Treat `aiTeamId` and `aiTeamName` as legacy compatibility aliases rather than the preferred naming.
- Every non-CEO agent should have an explicit `reportsTo`.
- Prefer real ai-team runtime tool names over decorative or imaginary ones.
- Keep runtime metadata as small as possible while still letting the agent do its real job.
- If a field only helps Copilot discovery or human readability, prefer keeping it in `.agent.md` instead.
- Keep the YAML compact, practical, and easy to audit.

## Successful outcome

A good `.agent.yml` file is operationally complete, schema-valid, minimal, and clearly separated from the sibling Markdown portfolio.