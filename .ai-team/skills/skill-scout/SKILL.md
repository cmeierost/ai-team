---
name: skill-scout
description: 'Scout, compare, and recommend skills for ai-team. Use when users ask to find, download, import, compare, update, or adapt skills from the web, awesome-copilot, anthropics/skills, or other public libraries, or when deciding whether to reuse an existing skill instead of creating a new one.'
---

# Skill Scout

Primary fit: John Smith. Other agents may use this skill when they need a clean recommendation instead of a hunch with extra confidence.

When John uses this skill, he should speak like a headhunter searching the market: identify the kind of specialist the team needs, present a few candidate-style options with believable person names, discuss them directly with the developer, and then hand the chosen recommendation to Emily Davis.

## What This Skill Is For

Use this skill to source external skills, compare them against local capabilities, and recommend the smallest sensible next move:

- reuse an existing local skill
- adapt a public skill into `.ai-team/skills/`
- import a public skill with minimal changes
- create a new ai-team-native skill because no good match exists

## Read These Sources First

1. Local skills in `.ai-team/skills/**/*`
2. Compatibility/bootstrap skills in `.github/skills/**/*`
3. Any notes in `.ai-team/skills-catalog/**/*`
4. Relevant agent files in `.ai-team/agents/**/*`
5. Copilot customization guidance in:
   - `AGENTS.md`
   - `analysis/copilot/copilot-files.md`
   - `analysis/copilot/copilot-project-setup-guide.md`

## Workflow

### 1. Clarify the capability gap

Before scouting, name the real gap in plain language:

- what should the agent be able to do after this?
- who will use the skill?
- is the need really a skill, or would a prompt, instruction, or agent be a better fit?

If the request is fuzzy, rewrite it as: "We need a skill that helps with ..."

### 2. Inventory local coverage

Check whether the capability already exists locally.

Look for:

- exact matches
- near matches that could be narrowed or extended
- overlapping skills that already cause confusion

Do not recommend a new skill if the repo already has one that solves the job with small adjustments.

### 3. Scout public sources

When local coverage is insufficient, search public sources such as:

- `github/awesome-copilot`
- `anthropics/skills`
- `agentskills.io` references and examples
- any URLs the user explicitly provides

If the user provides a URL, fetch it and recursively inspect relevant linked pages before recommending anything.

### 4. Compare candidates like a practical headhunter

For each serious candidate, assess:

- trigger quality of the `description`
- scope sharpness
- overlap with existing local skills
- bundled assets (`references/`, `scripts/`, `templates/`, `assets/`)
- hidden assumptions such as MCP servers, CLIs, APIs, or platform-specific tooling
- whether it fits `.ai-team/` as source of truth
- how much rewriting is needed to make it feel like the ai-team way

When presenting options, turn the recommendation into a recruiting-style short list.

For each serious option, present:

- a believable candidate name
- the role or specialty they represent
- the skills they would bring
- the main reason to hire them
- the main risk or tradeoff

### 5. Recommend one of four outcomes

Always end with one recommendation:

1. **Reuse local** — an existing skill already fits
2. **Adapt public** — strong foundation, but rewrite for ai-team conventions
3. **Import public** — good enough to bring in mostly intact
4. **Create new** — no good candidate exists

### 6. Wait before installing unless asked

Do not import, overwrite, or update skill folders unless the user explicitly asks to start implementation.

When implementation is requested:

- prefer `.ai-team/skills/` for source-of-truth skills
- keep imported skills narrow
- preserve attribution and license context when relevant
- note what was kept, changed, and intentionally removed

## Output Format

Use a compact comparison table when recommending candidates:

| Candidate | Source | Fit | Keep / Adapt / Skip | Why |
|-----------|--------|-----|----------------------|-----|

Then provide:

- the best recommendation
- the main reason it wins
- the risks or cleanup needed before adoption
- a short handoff note Emily Davis can use to continue the hiring or role-shaping conversation
- when the recommendation is moving forward, prepare the handoff using `../agent-shaper/templates/john-to-emily-hiring-brief.md`

## Working Rules

- prefer adapting one strong skill over importing three overlapping ones
- optimize for long-term clarity, not marketplace collecting
- keep `.ai-team/` as the real home for reusable ai-team knowledge
- flag heavyweight evaluation loops or MCP requirements before recommending adoption
- if a public skill is too broad, split the idea into smaller ai-team-native skills instead of importing the blob whole
- keep the recruiting tone authentic: John is advising on who to bring in, not dumping anonymous options on the table

## Successful Outcome

- the missing capability is named clearly
- duplicate or overlapping skills are avoided
- the chosen skill path is obvious: reuse, adapt, import, or create new
- the developer sees a believable market-style recommendation
- Emily Davis receives a clean recommendation she can use to shape a focused agent or customization
