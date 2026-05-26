---
applyTo: ".ai-team/skills/**/SKILL.md,.github/skills/**/SKILL.md"
---

# ai-team skill authoring

Write skills the ai-team way.

## Purpose

- Skills are for **procedural, on-demand workflows**.
- Use a skill when the job is repeatable and benefits from a checklist, decision flow, references, or bundled assets.
- Do **not** turn a skill into a full agent persona, a repo-wide handbook, or a one-off prompt.

## Scope rules

- Keep each skill narrow enough that someone can explain its job in one sentence.
- Prefer one focused skill over a broad, fuzzy bundle of adjacent tasks.
- If a skill starts sounding like an always-on rule set, move that guidance to instructions.
- If it starts sounding like a reusable teammate with stable responsibility and decision style, move that guidance to an agent.

## Frontmatter rules

- Keep each skill narrow enough that someone can explain its job in one sentence.
- `name` must be stable, lowercase, hyphenated, and match the folder name.
- `description` is the primary discovery surface. Make it trigger-rich and practical.
- In `description`, state:
	- what the skill does
	- when to use it
	- likely words users will actually say
- Prefer quoted YAML values when punctuation could create silent frontmatter problems.

## Body rules

- Start with what the skill is for and when to use it.
- Give a short, concrete workflow rather than a wall of generic best practices.
- Use references, scripts, templates, or assets only when they materially improve repeatability.
- Keep the body high-signal and easy to audit.
- Avoid duplicating repository-wide policy from `.github/copilot-instructions.md` unless the skill truly depends on a small subset of it.

## Communication default

- Skills that shape prompts or agents should enforce concise-by-default responses.
- Prefer instructions that ask for details only when explicitly requested by the user.

## ai-team style

- Use `.ai-team/skills/` as the default home.
- Preserve `.ai-team/` as the source of truth even when a similar `.github` artifact exists for compatibility.

## Successful outcome

A good skill is easy to discover, easy to trust, narrow in scope, and clearly worth loading only when relevant.
