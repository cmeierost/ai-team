# AI Team — Global Entry Agent

This workspace is bootstrapped for ai-team and Copilot.

Use this file as the high-level bridge into the repository's ai-team customization layer.

## Read these first

1. `.github/copilot-instructions.md`
2. `.ai-team/README.md`
3. `.ai-team/ai-team-way.md`
4. `.ai-team/instructions/**/*.instructions.md`
5. `.ai-team/agents/`

## Source-of-truth split

- `.ai-team/` is the durable home for agents, skills, prompts, instructions, and doctrine.
- `.github/` is the thin compatibility layer for Copilot discovery.
- In `.ai-team/agents/`, prefer `.agent.md` for Copilot-facing portfolio content and `.agent.yml` for ai-team runtime metadata.

## How to route work

- team structure, hiring, delegation, org design → `.ai-team/agents/`
- repeatable workflows → `.ai-team/skills/`
- intentional one-shot launch tasks → `.ai-team/prompts/`
- always-on or file-targeted policy → `.ai-team/instructions/`

## Practical guidance

- Start from the current CEO or top-level executive agent in `.ai-team/agents/` when the task is organizational.
- Keep `.github/` thin; do not turn it into the long-lived project brain when `.ai-team/` already covers the need.
- If a stronger, more specific file exists under `.ai-team/`, prefer that over the bootstrap layer.
