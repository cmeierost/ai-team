# Documentation Map (Progressive Disclosure)

Use this file to keep context loading small and predictable.

## Read by depth

### Depth 0 — startup (tiny)

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `COPILOT-CONTEXT.md`

### Depth 1 — architecture orientation (short)

- `docs/architecture/overview.md`
- `docs/architecture/diagrams.md`

### Depth 2 — deep references (load only if task needs it)

- `ARCHITECTURE.md` (detailed architecture + entry points)
- `docs/api/contracts.md` (transport/API/WebSocket contracts)
- `docs/implementation/*` (implementation-specific deep dives)

## Task-driven loading

- **Simple local code change**: Depth 0 only
- **Cross-package/backend architecture change**: Depth 0 + Depth 1, then open targeted section in Depth 2
- **API route or WS event work**: Depth 0 + `docs/api/contracts.md`
- **Frontend state architecture work**: Depth 0 + `docs/implementation/web-state-architecture.md`

## Cost guardrail

Do not preload deep docs by default. Start with the smallest doc set that can answer the current question, then escalate only when a concrete gap appears.
