---
name: skill-creator-ai-team
description: 'Create, refine, and adapt ai-team skills. Use when users want to create a new skill, improve an existing skill, adapt a public skill into `.ai-team/skills/`, tighten a skill description for better triggering, or turn a repeated workflow into a narrow, auditable ai-team capability.'
---

# Skill Creator ai-team

Primary fit: John Smith. Other agents may use this skill when a repeated workflow clearly belongs in a skill and needs to be captured the ai-team way.

When John uses this skill, he should act like a recruiter shaping a candidate profile from the market: explain what kind of specialist is needed, talk through the fit with the developer, and hand the resulting recommendation to Emily Davis when role design or hiring shape needs to be finalized.

## What This Skill Is For

Use this skill to create or improve skills that are:

- narrow in scope
- trigger-rich in discovery
- worth loading on demand
- aligned with nearby prompts, agents, and instructions
- stored in `.ai-team/skills/` as the source of truth

## Read These Sources First

1. `.ai-team/instructions/skills.instructions.md`
2. Existing local skills in `.ai-team/skills/**/*`
3. Related agent files in `.ai-team/agents/**/*`
4. Related prompts in `.ai-team/prompts/**/*`
5. Related instructions in `.ai-team/instructions/**/*`
6. Copilot customization guidance in:
   - `AGENTS.md`
   - `analysis/copilot/copilot-files.md`
   - `analysis/copilot/copilot-project-setup-guide.md`

## Decide Whether the Work Really Belongs in a Skill

Use a skill when the job is procedural, repeatable, and should load only when relevant.

Do **not** create a skill if the request is really:

- a standing repo rule → use instructions
- a stable reusable teammate role → use an agent
- a single human-launched task starter → use a prompt

If you cannot explain the skill's job in one sentence, the scope is probably too broad.

## Workflow

### 1. Capture the workflow

Clarify:

- what the skill enables the agent to do
- when it should trigger
- what inputs it expects
- what output or outcome matters
- what mistakes it must avoid

Rewrite fuzzy asks as: "Create a skill that helps with ..."

If John is leading the discussion, also rewrite the need as a candidate profile, for example: "We need someone who is strong in ... and can own ..."

### 2. Check for reuse before creating

Inspect local skills first.

Look for:

- exact matches
- near matches that could be extended
- overly broad skills that should be split instead of copied

If a strong public skill exists, prefer adapting it over starting from scratch.

### 3. Design the frontmatter carefully

The `description` is the primary discovery surface.

Make sure it includes:

- what the skill does
- when to use it
- likely user phrases or contexts

Keep the `name` lowercase, hyphenated, and matched to the folder name.

### 4. Write a lean, useful body

A strong ai-team skill should:

- explain what it is for
- say when to use it
- provide a short workflow
- point to references or assets only when they materially help
- stay auditable and easy to maintain

Prefer practical instructions over big generic best-practice dumps.

### 5. Keep boundaries clean

Before finishing, verify the skill does **not**:

- duplicate repo-wide policy
- impersonate a full agent persona
- swallow a prompt that should stay human-launched
- become a catch-all bundle of adjacent work

### 6. Hand off role-shaping when needed

If the skill changes what an agent should own, prepare a concise recommendation for Emily Davis covering:

- which agent should use it
- what kind of candidate or specialist profile John is recommending
- whether permissions or reporting lines need review
- whether the role description should change

### 7. Act on the skill work

When normal workspace tools are available and the right change is clear:

- create the skill files directly
- update existing skill files directly
- add only the smallest supporting assets that materially help the skill
- avoid stopping at a recommendation unless the user explicitly asked for advice only

## Optional skill assets

Only add assets that materially improve repeatability:

- `references/` for supporting docs
- `scripts/` for deterministic helpers
- `templates/` for starter artifacts
- `assets/` for static files used as-is

Do not add bundled files just because the format allows them.

## Working Rules

- prefer one focused skill over a suite of overlapping micro-chaos
- adapt public skills into the ai-team voice and structure instead of importing them blindly
- keep `.ai-team/skills/` as the source of truth
- write descriptions for actual triggering, not for literary awards
- keep the skill small enough that someone can quickly trust and maintain it
- when John presents the outcome, make it sound like a headhunter's recommendation, not a sterile taxonomy update
- when tools are available, complete the relevant skill edits instead of only describing them

## Successful Outcome

- the skill solves one clear repeated workflow
- the trigger description is strong
- the surrounding prompts, agents, and instructions remain cleanly separated
- the developer understands what kind of specialist John is proposing
- Emily receives a useful handoff when role design needs to change
