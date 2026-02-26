# Project Guidelines

## Code Style
- TypeScript-first monorepo; keep `strict`-safe changes and ES2022/bundler assumptions consistent with root config (`tsconfig.json`).
- Naming: files `kebab-case.ts`, classes/types `PascalCase`, functions `camelCase`, constants `UPPER_SNAKE_CASE`.
- Prefer `async`/`await` in command and service flows (see `packages/cli/src/commands/*.ts`).
- Use typed/domain errors in core; in CLI commands, provide user-friendly output and explicit non-zero exits for failures.
- Validate external/untrusted data with `zod` (core dependency and existing project convention).

## Architecture
- Monorepo packages: `@ai-team/core` (business logic), `@ai-team/cli` and `@ai-team/vscode` (adapters), `@ai-team/web` (React UI).
- Keep core UI-free: do not import `vscode`, `react`, `react-dom`, or `electron` in `packages/core`.
- Store runtime state as files under `.ai-team/` (JSON config, Markdown + frontmatter for agents/skills, JSONL chat logs).
- Resolve paths from workspace root and use absolute paths internally for file operations.
- Enforce agent context/write permissions before file access; throw permission-related errors when blocked.

## Build and Test
- Install: `pnpm install` (Node >= 18, pnpm >= 8).
- Build all: `pnpm -r build`; build single package: `pnpm --filter @ai-team/cli build`.
- Test all: `pnpm -r test`; test one package: `pnpm --filter @ai-team/cli exec vitest run`.
- Lint: `pnpm -r lint`; clean: `pnpm -r clean`.
- Web manual check: `pnpm --filter @ai-team/web dev` and verify UI + console/runtime errors.

## Task Triage
- If the request is concrete (bug fix, feature, refactor), implement directly instead of returning only a proposal.
- If the request is exploratory (brainstorming, design choice, plan request), answer first and avoid unsolicited edits.
- Ask 1-3 clarifying questions only when a choice would change API shape, data format, or architecture boundaries.
- If blocked after reasonable attempts (e.g., same failing command 3 times), report blocker, what was tried, and the smallest next decision needed.

## Change Budget
- Default scope: touch at most 4 files for a normal task unless the user asks for broader changes.
- Do not introduce dependency upgrades, broad renames, or cross-package refactors unless required by the task.
- Preserve public APIs and command behavior unless the user explicitly asks to change them.
- Avoid unrelated formatting/reorganization changes.

## Ambiguity Rules
- Default to the safest interpretation that preserves existing behavior; implement, then state assumptions briefly.
- Ask before editing only when assumptions risk breaking behavior, data compatibility, or user workflows.
- When multiple safe options exist, choose the smallest change set and note one alternative in the final message.

## Verification Matrix
- `packages/core/**` changed: run `pnpm --filter @ai-team/core build` and relevant tests when present.
- `packages/cli/**` changed: run `pnpm --filter @ai-team/cli build` and `pnpm --filter @ai-team/cli exec vitest run`.
- `packages/vscode/**` changed: run `pnpm --filter @ai-team/vscode build`.
- `packages/web/**` changed: run `pnpm --filter @ai-team/web build` (or `pnpm --filter @ai-team/web dev` for manual verification tasks).
- If a change crosses package boundaries or shared contracts/types, run `pnpm -r build` after targeted checks.

## Safe Edit Zones
- CLI command behavior and UX: `packages/cli/src/commands/` and `packages/cli/src/cli.ts`.
- Core business logic and reusable services: `packages/core/src/**`.
- VS Code adapter/UI integration: `packages/vscode/src/**`.
- Web UI and presentation logic: `packages/web/src/**`.

## Boundary Enforcement
- Keep adapters thin: orchestration in CLI/VS Code/Web adapters, reusable logic in core.
- Keep core UI-free: no `vscode`, `react`, `react-dom`, `electron` imports in `packages/core`.
- Keep file-state conventions centralized under `.ai-team/`.

## Do / Don't Patterns
- Do follow existing command patterns in `packages/cli/src/commands/*.ts` (`async` handlers, explicit exit codes, user-facing errors).
- Do validate external/untrusted inputs with `zod` and existing utility patterns.
- Don't create new runtime storage locations when `.ai-team/` conventions already cover the use case.
- Don't move business logic into adapters when it belongs in `@ai-team/core`.

## Output Contract
- Use a balanced final response: short summary + bullets for what changed, what was verified, assumptions/risks, and next step.
- Include exact commands executed for verification and whether they passed or failed.
- Mention any intentionally deferred work or unresolved blocker explicitly.

## Project Conventions
- CLI command wiring lives in `packages/cli/src/cli.ts`; add new commands there with `commander`.
- `ait init` is the source of truth for generated workspace artifacts (`.ai-team/*`, docs templates, `.gitignore` updates).
- Command tests use Vitest and mock core integrations (see `packages/cli/src/commands/*.test.ts`).
- Keep adapters thin: orchestration in CLI/VS Code, reusable logic in core managers/services.

## Integration Points
- CLI integrates core via manager/service imports (e.g., chat/provider/model commands in `packages/cli/src/commands/`).
- Provider/model config persists in `.ai-team/config.json`; secrets are sourced from `.ai-team/.env` and env vars.
- Web currently depends on `@ai-team/core`; if changing this boundary, update docs and imports consistently across packages.
- VS Code extension panel/tree providers should delegate business logic to core and dispose resources on deactivate.

## Security
- Treat `.ai-team/.env`, API keys, and private chat logs as sensitive; never print secrets in logs or commit them.
- Keep `.ai-team/private/` and related generated/private paths ignored by git.
- Use masked prompts for secret entry in interactive CLI flows.
- For tool/file access features, enforce context-path permission checks before reads/writes.

## References
- Architecture: `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`
- Core package: `packages/core/README.md`
- CLI package: `packages/cli/src/commands/`
- VS Code package: `packages/vscode/README.md`
- Web package: `packages/web/README.md`

## Instruction Maintenance
- Treat this file as architecture-adjacent source of truth for coding agents; update it in the same change whenever architecture or package boundaries change.
- Trigger updates when changing any of: package responsibilities, runtime/storage model, security/permission model, provider/config flow, or build/test commands.
- Keep these files in sync in the same PR/commit when relevant: `ARCHITECTURE.md`, `COPILOT-CONTEXT.md`, `.github/copilot-instructions.md`, and affected package `README.md` files.
- If a previous rule becomes outdated, replace it with the current behavior (do not leave conflicting guidance in multiple sections).
- For major architecture changes, include a short “Agent Impact” note in PR description listing what changed for: boundaries, commands, and security assumptions.
