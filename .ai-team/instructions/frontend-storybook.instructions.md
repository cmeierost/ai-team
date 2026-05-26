---
applyTo: "packages/web/src/**/*.tsx"
---

# web tsx Storybook readiness

Use this instruction when working on React TSX files in the web package.

## Purpose

Keep important UI components Storybook-usable when that meaningfully improves frontend quality, reviewability, reuse, or responsive review across phone and desktop layouts.

## Rules

- When creating or materially changing an important UI component, prefer a shape that can be rendered in Storybook when that makes practical sense.
- Add or update a Storybook story for reusable or review-worthy UI components when the component has isolated visual or interaction value.
- Prefer prop-driven composition, mockable inputs, and clear wrapper boundaries so the component can be previewed without requiring the full app runtime.
- When a component has meaningful layout behavior, use Storybook to make important mobile and desktop states easier to review.
- If a component depends on routing, context, async data, or browser APIs, make it Storybook-friendly with the smallest reasonable seam:
  - a focused wrapper or decorator
  - extracted presentational subcomponents
  - mock data or story fixtures
  - optional dependency injection where appropriate
- For important UI components, prefer stories that help validate responsive behavior when that behavior matters to real use:
  - narrow mobile widths
  - wider desktop widths
  - important visual states that may shift across breakpoints
- Do not force every TSX file into Storybook. Tiny glue components, one-off route wiring, and app-only shells do not need stories unless they clearly benefit from visual or interaction review.
- Treat Storybook as a frontend quality surface, not as decorative documentation.

## Good triggers

This rule especially applies to:

- reusable UI components
- components with meaningful visual states
- components with meaningful interaction states
- components with meaningful responsive layout states
- components that are likely to regress visually
- components that benefit from design or QA review outside the full app

## Usually not required

A Storybook story is usually not required for:

- `App.tsx`-style top-level composition files
- narrow routing glue
- thin provider wrappers with no meaningful standalone UI
- components whose value only appears in a full application runtime and would require excessive scaffolding to isolate

## Successful outcome

- important UI components that should be reviewed in isolation can be exercised through Storybook
- important responsive states can be reviewed for both phone and desktop when that adds quality value
- component APIs stay easier to preview, test, and reason about
- Storybook coverage grows where it adds quality value instead of becoming mandatory theater
