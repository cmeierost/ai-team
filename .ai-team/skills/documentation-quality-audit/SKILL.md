---
name: documentation-quality-audit
description: 'Use when Taylor or another teammate needs to review repository docs for missing, stale, duplicated, unclear, or hard-to-navigate content and turn that into a concrete documentation improvement plan.'
---

# Documentation quality audit

Use this skill when the job is to figure out whether the repository documentation needs improvement, not just to rewrite a paragraph on instinct.

This includes:

- auditing README files, docs, architecture notes, and work-tracking docs for clarity and usefulness
- identifying missing, stale, duplicated, contradictory, or weakly routed documentation
- checking whether source-of-truth boundaries are clear
- turning documentation findings into a clean, actionable improvement plan
- improving the relevant docs directly when the fixes are straightforward

## Read these first

1. `AGENTS.md`
2. `ARCHITECTURE.md`
3. `COPILOT-CONTEXT.md`
4. `README.md`
5. `docs/**/*`
6. `packages/*/README.md`
7. `analysis/**/*` when the docs depend on deeper research notes
8. `todo/**/*` or `.ai-team/plans/**/*` when work-in-progress docs need coordination cleanup

## Workflow

### 1. Define the documentation surface

Identify what documentation surface is being reviewed:

- repository root docs
- architecture docs
- package README files
- work-tracking or onboarding docs
- a focused feature or implementation document set

Do not treat the whole repo as one blob if the problem is limited to a narrower area.

### 2. Audit for the common failure modes

Look for:

- missing docs for an important surface
- stale docs that no longer match the code or workflow
- duplicated docs with unclear source-of-truth ownership
- weak navigation where readers cannot tell where to start
- vague docs that explain too little to be useful
- long docs that bury the key point instead of surfacing it

### 3. Compare docs against reality

Check whether the docs still match:

- the current package boundaries
- the current commands and verification flow
- the actual folder structure
- the current ownership model and agent routing where relevant

If the docs conflict with the code or current repo structure, call that out directly.

### 4. Summarize findings cleanly

For each meaningful issue, capture:

- **Surface** — which file or doc area is affected
- **Problem** — what is wrong
- **Why it matters** — how it slows readers down or creates confusion
- **Recommended fix** — update, split, merge, redirect, or remove
- **Owner** — who should confirm technical accuracy if needed

### 5. Improve the easy wins directly

When the needed fix is straightforward and within scope:

- tighten headings and structure
- remove obvious duplication
- improve navigational entry points
- clarify source-of-truth links
- update stale wording that is clearly wrong

When the real issue is architectural uncertainty or missing implementation truth, flag the gap instead of inventing certainty.

## Working rules

- audit before rewriting
- prefer the smallest change that improves clarity materially
- protect source-of-truth boundaries instead of duplicating the same guidance everywhere
- make findings easy for the right owner to act on
- distinguish documentation problems from underlying product or architecture ambiguity

## Successful outcome

- documentation gaps are visible instead of hidden
- readers can tell where to start and what to trust
- stale or duplicated docs are reduced
- the repo becomes easier to navigate for both humans and agents
