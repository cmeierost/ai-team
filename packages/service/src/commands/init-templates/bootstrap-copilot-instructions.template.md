# AI Team Copilot bootstrap instructions

This file is a thin compatibility bridge for Copilot discovery.

The authoritative ai-team customization layer lives under `.ai-team/`. Use `.github/` as bootstrap metadata, not as the long-lived source of truth.

## Read these first

1. `AGENTS.md`
2. `.ai-team/README.md`
3. `.ai-team/ai-team-way.md`
4. `.ai-team/instructions/**/*.instructions.md`
5. `.ai-team/agents/**/*.agent.md`

## Source-of-truth rules

- `.ai-team/` is the durable source of truth for agents, skills, prompts, instructions, and doctrine.
- `.github/` is an optional Copilot compatibility layer, not the default home for agents, prompts, or skills.
- In `.ai-team/agents/`, prefer `.agent.md` for Copilot-facing portfolio content and `.agent.yml` for ai-team runtime metadata.

## Working defaults

- Prefer the smallest change set that preserves existing project behavior.
- Infer the project's language, framework, and structure from the repository before making stack-specific assumptions.
- Keep reusable workflows in skills or prompts instead of bloating agent files.
- Preserve YAML frontmatter + Markdown body structure when editing agent, prompt, or skill files.
- Validate the area you changed before finishing.

## Compatibility note

This file is intentionally generic so `ait init` can bootstrap many different projects safely. Add project-specific architecture, package, and validation guidance under `.ai-team/` once the repository shape is clearer.
