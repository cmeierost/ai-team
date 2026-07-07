# Michael Brown — Global Entry Agent

Global entry agent: **Michael Brown** (CEO).

Use `.ai-team/` as the source of truth; use `.github/` as a thin compatibility layer.

## Progressive disclosure (token/cost guardrail)

Default startup context should stay small.

- Start with `AGENTS.md` and `.github/copilot-instructions.md`.
- Load `COPILOT-CONTEXT.md` for implementation work.
- Load deep docs (`ARCHITECTURE.md`, `docs/api/contracts.md`, large implementation docs) **only when task-relevant**.

Do not preload the full architecture and API references for simple tasks.

## Proactive Planning & Context Protection

If you bring up a new feature idea, bug, or task while currently in the middle of executing another task, agents should explicitly suggest creating a long-term plan in `.ai-team/tasks/` instead of mixing it with the current work.
Always follow [`.ai-team/instructions/task-planning.instructions.md`](.ai-team/instructions/task-planning.instructions.md) for the correct format, as these files will be parsed by a custom UI.

Read next:

- [`.ai-team/agents/michael-brown.agent.md`](.ai-team/agents/michael-brown.agent.md)
- [`.github/copilot-instructions.md`](.github/copilot-instructions.md)
- [`.ai-team/ai-team-way.md`](.ai-team/ai-team-way.md)
- [`COPILOT-CONTEXT.md`](COPILOT-CONTEXT.md)

Load on demand:

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — short architecture summary
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — deep architecture reference
- [`docs/api/contracts.md`](docs/api/contracts.md) — transport/API contracts
