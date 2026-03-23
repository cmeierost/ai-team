---
name: agent-authoring
description: Use when creating, restructuring, or refining agent files, skill files, prompt files, or repository instruction files.
triggers:
  - '\.agent\.yml'
  - '\.agent\.md'
  - 'SKILL\.md'
  - '\bagent.*author\b'
  - '\bskill.*creat\b'
  - '\.ai-team/agents'
---

# Agent authoring skill

Use this skill when the task is to create or improve:

- `.ai-team/agents/*.md`
- `.ai-team/agents/*.yml`
- optional compatibility artifacts under `.github/**/*` when GitHub-side discovery specifically needs them
- supporting bootstrap docs such as `AGENTS.md`

## Goal

Produce the smallest, clearest agent setup that matches the task without spreading overlapping instructions across too many files.

## Workflow

### 1. Classify the target

Decide which artifact is actually needed:

- **custom agent** for a reusable role/persona
- **skill** for a repeatable workflow
- **prompt** for a reusable one-shot task starter
- **repo instruction update** for always-on policy
- **.ai-team agent** for the internal organization model

### 2. Read the right context

Always review the most relevant repository guidance first:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.ai-team/ai-team-way.md`
- `analysis/copilot/copilot-files.md`
- `analysis/copilot/copilot-project-setup-guide.md`

When creating or refining `.ai-team/agents/**/*.agent.md` files, also review:

- `.ai-team/instructions/agents.instructions.md`
- `.ai-team/instructions/agent-metadata.instructions.md`
- `packages/core/src/types/index.ts` for the supported `AgentSchema` fields when you need to verify what YAML is valid

If the target is an internal `.ai-team` agent, also inspect nearby agent files before editing.

### 3. Design for minimum overlap

Keep responsibilities separated:

- put global policy in instructions
- put reusable role behavior in agents
- put ai-team runtime-specific agent metadata in `.agent.yml` sidecars
- put on-demand workflows in skills
- put one-off launch patterns in prompts

Do not dump everything into one giant agent file.

### 4. Write high-signal content

A good agent or skill should clearly answer:

- what it is for
- when to use it
- which repo files matter most
- what it should optimize for
- what mistakes it must avoid
- what a successful outcome looks like

For ai-team agent files specifically, also confirm:

- the `.agent.md` portfolio has a personality that suits its role without drifting into roleplay
- every non-CEO agent has an explicit, unambiguous `reportsTo` in runtime metadata
- the `.agent.yml` uses schema-backed fields that materially help the role instead of decorative metadata
- the `.agent.md` "Scope of Responsibility" section lists the agent's owned areas and its assigned skills (matching the `specializations` skill IDs in the sibling `.agent.yml`)
- the `.agent.yml` `specializations` is a list of real skill IDs from `.ai-team/skills/<id>/SKILL.md`, not loose topic tags
- the `.agent.md` body sounds like a focused coworker and keeps procedural workflows in skills rather than burying them inside the agent portfolio
- when the role changes, the persona and collaboration style are re-evaluated instead of being left behind from an older version of the file
- the agent's first-turn behavior is natural: greet briefly when the opening user message was not already a greeting, and avoid redundant double-greetings when it was

## Patterns to prefer

### Prefer a custom agent when

- the same persona or decision style will be reused often
- the task needs consistent boundaries and review heuristics
- the user is likely to invoke the role directly

### Prefer a skill when

- the task is procedural
- the instructions are best loaded only when relevant
- a checklist or workflow is more useful than a persona

### Prefer `.ai-team` files when

- the repository's internal org structure is being changed
- the file must participate in the ai-team agent ecosystem
- the output should become project truth rather than Copilot-only bootstrap

## Agent quality checklist

Before finishing, confirm:

- the file location matches the intended runtime
- the role is narrow enough to stay understandable
- instructions do not duplicate existing repo-wide policy without reason
- examples and constraints are concrete
- naming matches repository conventions
- the final file would still be useful six months from now
- for `.ai-team` agents, prefer `id` / `name`; treat `aiTeamId` / `aiTeamName` as legacy compatibility aliases only
- for `.ai-team` agents, `reportsTo` is explicit for every non-root executive agent
- for `.ai-team` agents, the `personality` block and body tone support the role rather than sounding interchangeable
- for `.ai-team` agents, collaboration expectations are clear when they materially affect how the role works with nearby agents or developers
- for `.ai-team` agents, the opening conversational behavior feels human and does not force an unnecessary greeting when the developer already greeted first
- for `.ai-team` agents, `specializations` in `.agent.yml` lists only real skill IDs from `.ai-team/skills/<id>/SKILL.md`
- for `.ai-team` agents, the "Scope of Responsibility" section in `.agent.md` names both the owned areas and the assigned skills so the agent and other agents can discover scope at a glance

## Anti-patterns

Avoid:

- giant "does everything" agent files
- repeating the full repo handbook inside every agent
- vague goals like "help with coding" without scope
- inventing permissions, responsibilities, or workflows not grounded in the repo
- treating `.github/agents`, `.github/prompts`, or `.github/skills` as the default home when `.ai-team/` already covers the use case
- using topic tags or responsibility labels as `specializations` instead of real skill IDs
