---
name: frontend-quality-storybook
description: 'Set up and improve Storybook, run Playwright-style and browser-driven frontend checks, and report browser or UI problems back to the web team in a structured, actionable way.'
---

# Frontend Quality Storybook

Use this skill when the work is about frontend quality infrastructure and browser-driven verification for the web package.

This includes:

- Storybook setup and maintenance
- component preview and review workflows
- Storybook-based component testing and interaction verification
- Playwright-style browser automation for component checks when browser tooling is available
- Chrome MCP-driven UI checks
- browser issue capture and structured bug reporting
- keeping frontend quality close to the web package owner and implementation loop

## Read These Sources First

1. `packages/web/README.md`
2. `packages/web/package.json`
3. `packages/web/src/**/*`
4. `docs/web-ui-development.md`
5. `.github/copilot-instructions.md`

## Workflow

### 1. Identify the quality objective

Clarify whether the task is about:

- setting up Storybook infrastructure
- validating components visually
- validating Storybook stories through Playwright-style interactions
- reproducing interaction bugs in the browser
- reporting issues back to the frontend owner

### 2. Keep testing close to the UI surface

- treat Storybook as part of the frontend workflow
- prefer Storybook stories as the component-level entry point when available
- use browser automation to exercise interactions, state changes, and console behavior rather than only eyeballing screenshots
- use Chrome MCP-driven checks for realistic browser validation when available
- report issues with enough context that the frontend owner can act quickly

### 3. Prefer structured reporting

For each issue, capture:

- affected component or screen
- story or reproduction URL when available
- reproduction path
- expected behavior
- observed behavior
- likely owner or collaborator

### 4. Validate after changes

- confirm the Storybook or quality setup still matches the current component structure
- confirm Playwright-style checks still target the current Storybook or browser flows correctly
- run `pnpm --filter @ai-team/web build`
- note any browser-only or interaction-specific problems separately from styling-only issues

## Working Rules

- keep frontend quality actionable, not vague
- use Storybook to support the team, not just to add tooling for its own sake
- treat Playwright-style testing as a way to prove interaction behavior, not as cargo-cult automation
- keep browser testing feedback tightly connected to the frontend owner
- separate visual polish issues from deeper interaction or state bugs when reporting

## Successful Outcome

- the frontend has usable Storybook and browser-driven quality workflows
- component behavior can be tested through Storybook and Playwright-style browser checks
- issues are reported clearly and routed to the right person
- frontend quality becomes repeatable instead of ad hoc