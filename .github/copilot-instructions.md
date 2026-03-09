# AI Team Copilot bootstrap instructions

This file is a **thin compatibility bridge** for Copilot discovery.

The authoritative ai-team customization layer lives under `.ai-team/`. Use `.github/` as bootstrap metadata, not as the long-lived source of truth.

## Read these first

1. `AGENTS.md`
2. `.ai-team/ai-team-way.md`
3. `ARCHITECTURE.md`
4. `COPILOT-CONTEXT.md`
5. `.ai-team/instructions/**/*.instructions.md`

## Repository snapshot

- TypeScript monorepo with CLI, VS Code, and Web surfaces
- Main runtime path: adapters -> `@ai-team/api-client` / `@ai-team/api-client-http` -> `@ai-team/service` -> `@ai-team/core` -> `.ai-team/*`
- Keep `packages/core` UI-free
- Prefer reusable business logic in `packages/core/src/**` and thin adapters in `packages/cli`, `packages/vscode`, and `packages/web`
- In `packages/web`, prefer TanStack Query for server state, Zustand for shared live runtime client state, and prop-driven Storybook-friendly views where practical

## Source-of-truth rules

- `.ai-team/` is the durable source of truth for agents, skills, prompts, instructions, and doctrine.
- `.github/` is an optional Copilot compatibility layer, not the default home for agents, prompts, or skills.
- In `.ai-team/agents/`, prefer `.agent.md` for Copilot-facing portfolio content and `.agent.yml` for ai-team runtime metadata.
- When detailed guidance exists in `.ai-team/`, follow that instead of duplicating policy here.

## Coding guardrails

- Validate external or untrusted input with `zod`.
- Use `async`/`await` in command and service flows.
- Use typed/domain errors in core; adapters should translate failures into user-friendly output.
- Do not create new runtime storage locations when `.ai-team/` already covers the use case.
- Preserve YAML frontmatter + Markdown body structure when editing agent files.

## Verification entry points

- Install dependencies with `pnpm install`.
- Build all packages with `pnpm -r build` when shared contracts or multiple packages change.
- Targeted checks:
  - `packages/core/**`: `pnpm --filter @ai-team/core build` and `pnpm --filter @ai-team/core exec -- vitest run`
  - `packages/cli/**`: `pnpm --filter @ai-team/cli build` and `pnpm --filter @ai-team/cli exec vitest run`
  - `packages/vscode/**`: `pnpm --filter @ai-team/vscode build`
  - `packages/web/**`: `pnpm --filter @ai-team/web build` or manual `pnpm dev:web` verification for UI work

## Change policy

- Prefer the smallest change set that preserves existing behavior.
- Avoid dependency upgrades, broad renames, and cross-package refactors unless required.
- If architecture, package boundaries, runtime storage, or verification commands change, update `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, this file, and affected package `README.md` files in the same change.
