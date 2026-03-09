---
name: vscode-extension-delivery
description: 'Work on the AI Team VS Code extension when the task touches `packages/vscode` commands, views, panels, decorations, configuration, or IDE-local integration while keeping the extension a thin adapter over shared logic.'
---

# VS Code Extension Delivery

Use this skill when the work is specifically about the AI Team VS Code extension surface.

This includes:

- command registration and command flow in `packages/vscode`
- tree views, panels, and editor decorations
- extension activation and local IDE-server wiring
- extension configuration and packaging concerns
- VS Code API and contribution-point fit for extension changes
- adapter-boundary decisions where VS Code-specific behavior must stay out of shared layers

## Read These Sources First

1. `ARCHITECTURE.md`
2. `COPILOT-CONTEXT.md`
3. `.github/copilot-instructions.md`
4. `packages/vscode/README.md`
5. `packages/vscode/package.json`
6. `packages/vscode/src/extension.ts`
7. `packages/vscode/src/ide-local-server.ts`
8. Relevant files under `packages/vscode/src/views/**/*`, `packages/vscode/src/panels/**/*`, and `packages/vscode/src/decorations/**/*`
9. `packages/ide-interface/src/**/*` when message shapes or integration contracts are involved

## Workflow

### 1. Classify the extension change

Identify which bucket the task belongs to:

- activation or initialization
- commands and command routing
- views or panels
- editor decorations or code-edit flows
- local IDE integration or connection state
- configuration or packaging

### 2. Trace the boundary before editing

Decide whether the change belongs in:

- `packages/vscode` for editor-specific UX and adapter logic
- `packages/ide-interface` for shared IDE message contracts
- `packages/service` or `packages/core` for reusable business logic

Do not push VS Code-specific assumptions into lower layers unless the contract genuinely needs to change.

### 3. Make the smallest coherent adapter change

- keep command IDs, view IDs, and configuration keys aligned between `package.json` and the TypeScript implementation
- prefer official VS Code API guidance when a command, view, contribution point, or extension behavior is ambiguous
- prefer small, surface-specific changes over broad refactors
- keep user-facing status, errors, and navigation clear inside the editor

### 4. Validate the extension surface

- check that contributed commands, views, and menus still match the implementation
- confirm editor-facing flows such as pending changes, diffs, and connection status still make sense after the change
- if shared contracts moved, widen validation to the affected lower package as needed

### 5. Run the package verification

- run `pnpm --filter @ai-team/vscode build`
- if the change touched shared contracts, run the relevant downstream build or test flow too

## Working Rules

- keep `packages/vscode` a thin adapter
- protect editor-native UX and responsiveness
- avoid mixing web-only interaction patterns into the extension surface
- treat `package.json` contributions and `src/` implementation as one system that must stay synchronized
- coordinate architecture-sensitive changes with Sarah Lee and lower-layer contract changes with the right implementation owner

## Successful Outcome

- the VS Code extension remains coherent and easy to maintain
- package boundaries stay intact
- commands, views, panels, and decorations stay synchronized
- the extension build passes after the change