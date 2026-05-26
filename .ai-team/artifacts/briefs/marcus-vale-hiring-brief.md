# Hiring Brief — Marcus Vale

Prepared by `john-smith` for `emily-davis`.

## Recommended hire

- **Name:** Marcus Vale
- **Role:** VS Code Extension Lead
- **Reports to:** `sarah-lee`

## Why this person exists

The repository now has a meaningful VS Code surface under `packages/vscode`, but no dedicated owner for that plugin as a first-class product and adapter surface.

Marcus exists to own:

- VS Code extension UX
- command, panel, and view behavior
- editor decorations and pending-changes flows
- extension-local integration quality
- the health of `packages/vscode` as a thin adapter over shared logic

## What Marcus should own

- `packages/vscode/**/*`
- extension activation and configuration flow
- commands, panels, views, and decorations
- local IDE integration through the VS Code plugin
- extension-specific maintainability and polish

## What Marcus should not own

- repository-wide architecture decisions that belong with `sarah-lee`
- core or service implementation ownership that belongs with `alex-morgan`
- all frontend or web UX work outside the VS Code extension surface
- general documentation ownership outside extension-specific docs and onboarding notes

## Key collaborations

- `sarah-lee` for package boundaries and architecture fit
- `alex-morgan` for shared contracts or lower-layer implementation changes
- `samuel-ceeses` for visual polish and presentation cleanup inside the extension surface
- `taylor-reed` for extension-facing docs and onboarding clarity

## Supporting assets prepared

- Agent portfolio: `.ai-team/agents/marcus-vale.agent.md`
- Runtime metadata: `.ai-team/agents/marcus-vale.agent.yml`
- Supporting skill: `.ai-team/skills/vscode-extension-delivery/SKILL.md`
- Org routing updates in:
  - `.ai-team/agents/michael-brown.agent.md`
  - `.ai-team/agents/michael-brown.agent.yml`
  - `.ai-team/agents/sarah-lee.agent.md`
  - `.ai-team/agents/sarah-lee.agent.yml`

## Skills and strengths Marcus brings

- VS Code extension API ownership
- editor-native UX instincts
- command/view/panel wiring discipline
- adapter-boundary judgment
- extension packaging and maintenance awareness

## Risks to watch

- the role becomes too broad and absorbs all UI work
- Marcus gets used as a generic TypeScript implementer instead of the VS Code surface owner
- extension-specific assumptions leak down into shared layers

## Recommended onboarding posture

Emily should onboard Marcus as a focused surface owner, not as a catch-all engineer.

That means:

- keep the role centered on the VS Code plugin
- reinforce the reporting line to `sarah-lee`
- use the `vscode-extension-delivery` skill for repeatable extension work
- preserve clear collaboration boundaries with Alex, Samuel, and Taylor

## Executive rationale

This hire reduces the risk that:

- `sarah-lee` becomes the default owner for all plugin decisions
- `alex-morgan` becomes the default sink for extension implementation work
- the VS Code plugin grows without a clear product or technical owner

## Next step for Emily

Shape Marcus as the dedicated owner of the VS Code plugin and keep the role narrow, practical, and editor-focused.
