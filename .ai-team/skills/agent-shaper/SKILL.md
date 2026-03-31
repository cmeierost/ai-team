---
name: agent-shaper
description: 'Shape or review ai-team agents from a hiring brief into a clear final portfolio. Use when Emily Davis or another agent needs to turn a role idea into a strong agent with the right personality, reporting line, handoffs, runtime metadata, and supporting skills.'
---

# Agent Shaper

Primary fit: Emily Davis. Other agents may use this skill when the work is specifically about shaping a person into a strong final agent, not just editing a random markdown file.

## What This Skill Is For

Use this skill when you need to turn a hiring idea, candidate brief, or fuzzy org request into a final agent design that fits the ai-team way.

This includes:

- shaping new agents
- restructuring existing agents
- reviewing whether an agent should exist at all
- deciding what belongs in YAML frontmatter versus the Markdown body
- deciding supporting skills, prompts, and instructions
- validating personality, reporting lines, handoffs, and `.perm` path rules
- directly updating the relevant files when normal workspace tools are available

## Read These Sources First

1. `.ai-team/ai-team-way.md`
2. `.ai-team/instructions/agents.instructions.md`
3. `.ai-team/instructions/agent-metadata.instructions.md`
4. `packages/core/src/types/index.ts` — `AgentSchema`, `AgentHandoffSchema`
5. Existing agent files in `.ai-team/agents/**/*.agent.md`
6. Related skills in `.ai-team/skills/**/*`
7. Skill-local assets:
   - `templates/john-to-emily-hiring-brief.md`
   - `references/good-agent-examples.md`

## Workflow

### 1. Clarify the organizational need

Before shaping the agent, answer:

- what job actually needs to exist?
- who will ask this person for help?
- what outcomes should they own?
- what adjacent teammates do they work with?
- is this really an agent, or should it be a skill, prompt, or instruction?

### 2. Read the hiring brief like HR, not like a YAML parser

If John Smith or the developer provided a brief, extract:

- role name
- candidate-style personality fit
- core responsibilities
- reporting line
- required skills
- likely permissions
- main risks if the role becomes too broad

### 3. Shape the person

Decide deliberately:

- how this person should sound
- what kind of conversation they invite
- how warm, direct, strategic, structured, or chatty they should be
- how their first-turn greeting should feel

Write the personality so it supports the job instead of becoming decoration.

### 4. Shape the frontmatter

Every agent is a single `.agent.md` file: YAML frontmatter for all metadata, Markdown body for the portfolio.

**Required fields:**

- `role` — the agent's job function
- `contextLevel` — `organization`, `project`, `feature`, or `task`
- `reportsTo` — explicit manager ID (every non-CEO agent needs this)

**Identity overrides (usually omitted):**

- `name` — only needed when the display name should differ from the filename-derived default
- `aiTeamId` / `id` — only needed when the internal ID should differ from the filename slug
- `aiTeamName` — legacy alias for `name`; same override rule applies

Most agents omit `name`, `id`, `aiTeamId`, and `aiTeamName` entirely because the runtime derives them from the filename.

**Common optional fields:**

- `type` — `executive`, `manager`, `individual-contributor`
- `specializations` — list of real skill IDs from `.ai-team/skills/<id>/SKILL.md`; keep narrow
- `description` — main discovery surface for Copilot routing; make it explicit, concrete, and trigger-rich
- `personality` — `communication_style`, `expertise_level`, `mentoring`
- `avatar` — `type`, `url`, `color`
- `tools`, `disallowedTools`, `cliTools`
- `canDelegate`, `delegatesTo`, `availableFor`
- `model` — Copilot model preference

**Handoffs:**

- `handoffs` — array of `{ label, agent, prompt?, send?, model? }` for Copilot-native agent-to-agent routing
- The runtime auto-syncs `[auto]` handoffs from `reportsTo` and `delegatesTo` relationships via `syncHandoffs()`; these do not need to be written manually
- Manually authored handoffs (without the `[auto]` tag in the label) are preserved by the sync and should be added when a specific routing prompt or cross-team handoff is needed

**Do not put in frontmatter:**

- file-path read/write/create/delete globs — those live in `.ai-team/agents/<agent-id>.perm`
- long narrative text — that belongs in the Markdown body

Only add YAML fields that materially help the role. Keep frontmatter compact and auditable.

### 5. Shape the body

The Markdown body is the agent's portfolio. It should sound human and confident.

**Standard sections:**

- who the agent is (short intro paragraph)
- **Scope of Responsibility** — what the agent owns and which skills it uses; list both owned areas and the `specializations` skill IDs from frontmatter
- what files to read first (or use the `readTheseFilesFirst` frontmatter field)
- working rules
- successful outcome

**Body guidelines:**

- keep it personal and role-appropriate; an executive sounds strategic, a recruiter sounds evaluative
- keep procedural workflows in skills, not buried in the agent body
- first-turn greeting: greet briefly on the first reply unless the developer already opened with a greeting; avoid double-greeting
- make direct action the default when workspace tools are available

### 6. Shape the `.perm` file

Every agent that touches files needs a `.perm` file at `.ai-team/agents/<agent-id>.perm`.

- define read/write/create/delete glob rules appropriate to the agent's scope
- keep path access as narrow as the role allows
- do not put path globs in frontmatter

### 7. Check handoffs and delegation

Confirm:

- who this agent hands work to (via `handoffs` or `delegatesTo`)
- who hands work to this agent
- whether the `[auto]` handoffs from `reportsTo` and `delegatesTo` are sufficient or manual handoffs are needed
- whether John scouts for them
- whether Emily owns final design decisions
- whether the role overlaps an existing agent too much

### 8. Review quality before finalizing

Before finishing, confirm:

- the role is clear and the scope is narrow enough
- the personality is distinct and role-appropriate
- the body sounds like the intended person
- the reporting line is explicit
- handoffs are correct (auto-synced from org relationships, plus any manual additions)
- the `.perm` file gives appropriate path access
- the `specializations` list contains only real skill IDs
- the `description` is trigger-rich for Copilot discovery
- first-turn greeting behavior is natural
- the agent is not secretly a workflow or policy doc in disguise
- the agent can do its real job efficiently with the tools, permissions, and supporting assets it has

### 9. Act instead of only advising

When the environment provides normal workspace tools for reading and editing files, use them.

- update the agent file directly when the needed change is clear
- create or update the `.perm` file when path access needs to change
- create supporting skills, prompts, or instruction files when they are part of the solution
- avoid stopping at a recommendation unless the user explicitly asked for advice only

## Output Format

When shaping or reviewing an agent, summarize the result as:

- **Role**
- **Why this person exists**
- **Personality fit**
- **Reports to**
- **Handoffs** — auto-synced relationships and any manual handoffs
- **Supporting assets** — skills, prompts, instructions, `.perm` file
- **Risks to watch**

## Working Rules

- keep the agent human, but not theatrical
- prefer the smallest believable role
- keep `.ai-team/` as the source of truth
- use `.github/agents/` only when explicit GitHub-side compatibility is needed
- treat personality as design, not garnish
- make handoffs and delegation obvious
- omit `name`, `id`, `aiTeamId`, `aiTeamName` when the filename-derived defaults are correct
- when file tools are available, use them to complete the shaping work instead of only describing the work
- do not ship an agent that sounds good but is under-equipped to do its actual job

## Successful Outcome

- the new or updated agent feels like a real coworker
- the role is easy to understand and easy to route work to
- personality, reporting line, handoffs, and `.perm` path access are all clear
- surrounding skills, prompts, and instructions stay cleanly separated
