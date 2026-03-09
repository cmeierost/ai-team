---
name: workspace-bootstrap-architect
description: 'Design or refine the ai-team customization and bootstrap layer for Copilot. Use when users want to create or improve `AGENTS.md`, `copilot-instructions.md`, file-specific instructions, custom agents, prompts, or overall customization layout while keeping `.ai-team/` as the source of truth and `.github/` as a thin compatibility layer.'
---

# Workspace Bootstrap Architect

Primary fit: Emily Davis. Other agents may use this skill when the job is to shape the repository's Copilot-facing customization layer instead of editing product code.

## What This Skill Is For

Use this skill to create or refine the repository's customization architecture:

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.ai-team/instructions/**/*`
- `.ai-team/agents/**/*`
- `.ai-team/prompts/**/*`
- `.ai-team/skills/**/*`
- optional thin compatibility artifacts in `.github/**/*` when explicitly needed

## Read These Sources First

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. `.ai-team/ai-team-way.md`
4. `analysis/copilot/copilot-files.md`
5. `analysis/copilot/copilot-project-setup-guide.md`
6. `.vscode/settings.json`
7. Existing `.ai-team/agents/**/*`, `.ai-team/skills/**/*`, `.ai-team/prompts/**/*`, and `.ai-team/instructions/**/*`
8. `.ai-team/instructions/agents.instructions.md`
9. `.ai-team/instructions/prompts.instructions.md`
10. `.ai-team/instructions/skills.instructions.md`

## Core stance

Treat:

- `.ai-team/` as the source of truth
- `.github/` as an optional bootstrap and compatibility layer

Do not duplicate large bodies of knowledge across both unless there is a compelling compatibility reason.

## Workflow

### 1. Classify the artifact correctly

Decide whether the need belongs in:

- instructions → always-on or file-targeted policy
- prompt → focused human-launched task starter
- skill → repeatable on-demand workflow
- agent → reusable specialist teammate with stable role boundaries
- bootstrap doc → top-level discovery and navigation

### 2. Keep the layer thin and intentional

Before writing anything, ask:

- does this belong in `.ai-team/` or `.github/`?
- does the file reduce confusion, or just add another place for drift?
- is the guidance specific enough to be worth loading?

### 3. Preserve the ai-team way

When shaping customization files:

- agents should feel like focused coworkers
- in `.ai-team/agents/`, prefer `.agent.md` for Copilot-facing portfolio content and `.agent.yml` for ai-team runtime metadata
- agents should greet naturally on their first reply when the conversation did not already begin with a greeting
- prompts should be personal, communicative, and scoped
- skills should stay procedural and auditable
- non-CEO agents should have explicit `reportsTo`
- agent personality should suit the role
- YAML/frontmatter should only use fields that are supported and materially useful

### 4. Design for discovery

Descriptions and top sections should help Copilot route work correctly.

Prefer:

- concrete trigger phrases
- clear ownership
- small files with strong headings
- practical language over generic best-practice filler

### 5. Validate the layout

Before finishing, confirm:

- the file lives in the right layer
- it does not duplicate stronger source-of-truth content elsewhere
- it fits the configured discovery locations in `.vscode/settings.json`
- the resulting customization set is easier to navigate than before

## Working Rules

- prefer the smallest structural change that improves clarity
- avoid giant bootstrap docs that try to solve every future problem
- keep instructions artifact-specific when possible
- let Emily own role and customization shape; let John scout and shape skill capability inputs
- if GitHub compatibility is needed, mirror only the minimum necessary content and do not treat `.github/` as the default home for agents, prompts, or skills

## Successful Outcome

- the repository's customization layer is easy to understand
- `.ai-team/` remains the true home for durable knowledge
- `.github/` stays thin and intentional
- agents, prompts, skills, and instructions each have a clean job
