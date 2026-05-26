---
applyTo: "packages/web/src/**/*.tsx,packages/web/src/**/*.css"
---

# web responsive ui requirement

Use this instruction when working on the web UI in `packages/web/src`.

## Purpose

Keep the UI responsive by default so the app is usable on phone and on desktop, and optimized for both instead of accidentally favoring only one screen size.

## Rules

- Treat responsive design as a core product requirement for the whole web UI, not as polish to add later.
- New screens, layouts, and important UI components should work on narrow mobile widths and on wider desktop layouts.
- Keep visual styling in CSS files rather than inline `style` props in `.tsx` files. Prefer `className` plus CSS rules for layout, spacing, typography, borders, shadows, and theme-driven visual styling.
- Use CSS variables for all theming concerns, not only basic colors. Theme-controlled values such as text color, background and surface color, border color, accent color, focus states, and similar visual tokens should be defined as reusable CSS variables and referenced with `var(...)`.
- Prefer layouts that adapt cleanly across breakpoints:
  - flexible containers
  - wrapping instead of overflow where appropriate
  - mobile-friendly spacing and tap targets
  - typography and panels that remain readable on small screens
- Avoid assumptions that only work on desktop, such as permanently side-by-side layouts, hover-only affordances, tiny click targets, or content that requires horizontal scrolling to function.
- When a desktop-first or mobile-first compromise is necessary, choose the option that preserves usability on both and explain the tradeoff in the change summary.
- When building reusable UI components, prefer APIs and structure that support responsive composition instead of hard-coded one-size-fits-desktop layouts.
- When a component needs a new theme token, add or extend a named CSS variable in the appropriate shared stylesheet instead of introducing raw theme values directly in the component or scattering hard-coded visual values across CSS files.

## Validation after changes

After meaningful UI changes, verify responsiveness instead of assuming it:

- check the affected UI at phone-sized and desktop-sized widths
- confirm navigation, reading, actions, and scrolling remain usable on both
- confirm important components still work without clipped content, broken layout, or inaccessible controls
- when Storybook coverage exists or makes sense, use it to review responsive states for important components
- run `pnpm --filter @ai-team/web build`

## Good triggers

This rule especially applies to:

- page layouts
- navigation and sidebars
- dashboards and card grids
- forms and action panels
- reusable UI components with meaningful layout behavior

## Successful outcome

- the web UI remains usable on phone and desktop
- responsive behavior is considered during implementation, not only after bugs appear
- important UI changes are tested for both mobile and desktop usability before finishing
