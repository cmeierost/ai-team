# AI Team Copilot bootstrap instructions

Thin compatibility bridge for Copilot. Authoritative customization lives under `.ai-team/`.

## Read first

1. `AGENTS.md`
2. `.ai-team/ai-team-way.md`
3. `ARCHITECTURE.md`
4. `COPILOT-CONTEXT.md`

## Core rules

- `.ai-team/` is source of truth; `.github/` is compatibility/bootstrap only.
- Main runtime path: adapters -> `@ai-team/api-client` / `@ai-team/api-client-http` -> `@ai-team/service` -> `@ai-team/core` -> `.ai-team/*`.
- Keep `packages/core` UI-free.
- Prefer reusable business logic in `packages/core/src/**` and thin adapters in `packages/cli`, `packages/vscode`, and `packages/web`.
- In `packages/web`, use TanStack Query for server state and Zustand for shared live runtime state.

## Tooling defaults (important)

- Use `pnpm` for dependency and script commands.
- Do NOT use `npm` or `yarn` unless explicitly requested.
- Prefer: `pnpm`, `git`, `eslint`, `prettier`, `tsc`, `vitest`.

## Coding guardrails

- Validate external/untrusted input with `zod`.
- Use `async`/`await` in command and service flows.
- Use typed/domain errors in core; adapters translate to user-friendly output.
- Do not create new runtime storage locations when `.ai-team/` already covers the use case.

## Verification

- Install dependencies with `pnpm install`.
- Build shared or multi-package changes with `pnpm -r build`.
- Use targeted package checks when scope is local (`pnpm --filter <pkg> build` and package tests).
- **For UI changes in `packages/web`, use the Chrome / browser MCP tools to visually inspect the result in the live app.** Use `open_browser_page`, `mcp_microsoft_pla_browser_run_code`, and `mcp_microsoft_pla_browser_console_messages` to open the page, interact with it, and check for visual regressions or console errors before considering the task done.

## Change policy

- Prefer the smallest safe change set.
- Avoid broad refactors or dependency upgrades unless required.
- If architecture, boundaries, runtime storage, or verification flow changes, update `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, this file, and affected package `README.md` files in the same change.
