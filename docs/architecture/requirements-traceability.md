# Requirements Traceability

Track how active requirements map to architecture and implementation.

| Requirement | Owner | Architecture Area | Implementation Area | Status |
| --- | --- | --- | --- | --- |
| Per-agent file-path policies must live in `.ai-team/agents/<agent-id>.access` | Chief Architect | `ARCHITECTURE.md` (Runtime State + File-System Access Model), `docs/architecture/overview.md` | `packages/core/src/storage/index.ts`, `packages/access/src/access-file.ts` | Implemented |
| Agent metadata sidecars must not be the source of file-path access globs | Chief Architect | `ARCHITECTURE.md` (File-System Access Model), `COPILOT-CONTEXT.md` (Runtime Artifacts) | `.ai-team/agents/*.agent.yml`, access adapter wiring in `packages/core/src/context/access-adapter.ts` | Implemented |
| Rights inheritance must be consistent across all surfaces (`write => read + list`, `read => list`) with explicit deny precedence | Chief Architect | `ARCHITECTURE.md`, `docs/architecture/diagrams.md` | `packages/access/src/engine.ts`, `packages/api-client/src/index.ts`, `packages/api-server/src/routes/**`, `packages/cli/src/commands/files.ts` | In progress |
