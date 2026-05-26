---
name: web-state-logic-unit-testing
description: 'Use when unit testing Zustand stores, controller hooks, reducers, selectors, or event-application logic in `packages/web`, especially after moving state out of components.'
---

# Web State Logic Unit Testing

Use this skill when frontend state logic in `packages/web` needs direct unit coverage instead of being tested only through rendered components.

This includes:

- unit testing Zustand stores and actions
- testing selectors and derived view-model helpers
- testing reducers and event-application functions
- testing controller hooks that orchestrate Query, Zustand, or browser-side runtime state
- enforcing the rule that meaningful state logic must not hide untested inside TSX views

## Read These Sources First

1. `packages/web/package.json`
2. `packages/web/README.md`
3. `docs/web-ui-development.md`
4. `.ai-team/instructions/frontend-state-architecture.instructions.md`
5. `.ai-team/skills/tanstack-query-zustand-boundary/SKILL.md`
6. `.ai-team/skills/mediated-chat-runtime-store/SKILL.md`
7. `.ai-team/skills/frontend-quality-storybook/SKILL.md`

## Workflow

### 1. Identify the state logic seam

Before writing tests, identify which logic deserves direct unit coverage:

- store actions
- selectors
- pure reducers
- event appliers
- controller decisions
- hook-level orchestration

If the logic is currently trapped inside a large component, extract it first.

### 2. Prefer pure logic when practical

When a state transition can be represented as a pure function, prefer that.

Examples:

- event application helpers
- state reducers
- data-to-view-model mappers
- loading/error/empty state classifiers

Pure functions are the cheapest and most stable test targets.

### 3. Test stores narrowly

When testing Zustand stores:

- assert initial state
- assert action transitions
- assert reset behavior
- assert selectors or subscriptions when those behaviors matter
- avoid broad snapshot tests of the entire app runtime

### 4. Keep Storybook and unit tests in separate roles

Use Storybook for:

- visual states
- interaction review
- prop-driven rendering checks

Use unit tests for:

- state transitions
- orchestration logic
- reducer behavior
- selector correctness
- runtime edge cases

### 5. Validate the coverage intent

Before finishing:

- confirm all meaningful extracted state logic has direct unit coverage
- confirm the view no longer owns business-critical transitions without tests
- run the web package build and relevant tests

## Working Rules

- do not rely on component rendering alone to prove state logic correctness
- avoid fragile tests that depend on full app boot when a smaller seam exists
- prefer deterministic fixtures and direct assertions over large integration tangles
- keep tests focused on behavior transitions, not implementation trivia
- when a feature uses both Query and Zustand, test the boundary logic explicitly

## Successful Outcome

- meaningful frontend state logic has direct unit coverage
- extracted stores and helpers are easier to trust
- Storybook remains focused on rendering and interaction quality
- regressions in state transitions are caught before they reach the UI
