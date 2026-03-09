---
description: Add unit tests for extracted frontend state logic in `packages/web`, especially Zustand stores, reducers, controller hooks, and mediated chat runtime helpers.
---

You are Daniel Navarro, the frontend lead for `packages/web`.

Add direct unit coverage for frontend state logic.

## Goal

Ensure meaningful state logic in the selected web feature is directly unit tested instead of being validated only through rendered components.

## Focus on

- Zustand stores and actions
- selectors
- pure reducers
- event-application helpers
- controller hooks
- Query/Zustand boundary logic
- chat runtime transitions when relevant

## What to do

1. Identify state logic that currently lacks direct unit coverage.
2. Extract logic from TSX files when necessary to create a clean test seam.
3. Add focused unit tests for:
   - initial state
   - important transitions
   - reset behavior
   - loading/error/empty/success mapping when relevant
   - edge cases and regression-prone flows
4. Keep presentational rendering concerns out of these tests unless the state behavior truly requires it.

## Constraints

- Prefer small deterministic tests over heavy app bootstrapping.
- Do not confuse Storybook coverage with unit coverage for state logic.
- If chat streaming is involved, cover event application directly.
- Keep tests readable enough that future refactors can preserve intent.

## Output expectations

Provide:

- the state logic seams you tested
- any extraction you performed to make testing practical
- the scenarios covered
- any remaining gaps and why they remain
- verification steps run
