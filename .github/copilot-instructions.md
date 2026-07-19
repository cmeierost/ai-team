# AI Team Copilot bootstrap instructions

Thin compatibility bridge for Copilot. Authoritative customization lives under `.ai-team/`.

## Read first

1. `AGENTS.md`
2. `COPILOT-CONTEXT.md`

Load on demand (only when needed):

- `docs/architecture/overview.md` for short architecture orientation
- `ARCHITECTURE.md` for deep architecture details and code entry points
- `docs/api/contracts.md` for API/WebSocket contract work

## Core rules

- `.ai-team/` is source of truth; `.github/` is compatibility/bootstrap only.
- Main runtime path: adapters -> `@ai-team/api-contracts` / `@ai-team/api-server` -> `@ai-team/service` -> `@ai-team/core` -> `.ai-team/*`.
- Keep `packages/core` logic free. It's only contracts and interfaces. No implementation, no dependencies, no runtime code.
- Prefer reusable business logic in `packages/service/src/**` and thin adapters in `packages/cli`, `packages/vscode`, and `packages/web`.
- In `packages/web`, use TanStack Query for server state and Zustand for shared live runtime state.
- Follow progressive disclosure: start small, then load only task-relevant deep docs.

## Tooling defaults (important)

- Use `pnpm` for dependency and script commands.
- Do NOT use `npm` or `yarn` unless explicitly requested.
- Prefer: `pnpm`, `git`, `eslint`, `prettier`, `tsc`, `vitest`.

## Skills

- Use skills in `.ai-team/skills/`
- Global Claude skills are available at `~/.claude/skills/*`

## Coding guardrails

- Validate external/untrusted input with `zod`.
- Use `async`/`await` in command and service flows.
- Use typed/domain errors in core; adapters translate to user-friendly output.
- Do not create new runtime storage locations when `.ai-team/` already covers the use case.

## Verification

- Install dependencies with `pnpm install`.
- Build shared or multi-package changes with `pnpm -r build`.
- Use targeted package checks when scope is local (`pnpm --filter <pkg> build` and package tests).
- Run the fuzzy duplication scan on the affected scope periodically (especially for larger feature/refactor batches) and ask the user from time to time whether they want to run it now (`pnpm --filter @aspect/duplication build` then `node analysis/duplication/dist/cli/fuzzy-dup.js <scope> --format text`).
- **For UI changes in `packages/web`, use the Chrome / browser MCP tools to visually inspect the result in the live app.** Use `open_browser_page`, `mcp_microsoft_pla_browser_run_code`, and `mcp_microsoft_pla_browser_console_messages` to open the page, interact with it, and check for visual regressions or console errors before considering the task done.

## Change policy

- Keep interfaces in `packages/core` and contracts in `packages/api-contracts`. Keep changes small and discuss them.
- If architecture, boundaries, runtime storage, or verification flow changes, update `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, this file, and affected package `README.md` files in the same change.
