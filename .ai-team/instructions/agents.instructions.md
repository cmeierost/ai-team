---
applyTo: ".ai-team/agents/**/*.agent.md,.github/agents/**/*.agent.md"
---

# ai-team agent authoring

Write agent files the ai-team way.

## Purpose

- Agents are reusable specialist teammates with a stable role, clear ownership, and a recognizable working style.
- An agent should feel like a person we are talking to: personal, communicative, and focused on the task.
- Do **not** make agents into giant containers for every workflow, repo rule, or implementation detail.

## Frontmatter rules

- Preserve YAML frontmatter and Markdown body structure.
- Keep ai-team identity fields when present, especially `aiTeamId` and `aiTeamName`.
- Prefer identity in this order when authoring or reviewing files:
  - `aiTeamId`
  - `id`
  - `aiTeamName`
  - `name`
  - `*.agent.md` filename fallback when identity is otherwise missing
- Preserve or clarify key ownership fields such as:
  - `role`
  - `type`
  - `contextLevel`
  - `reportsTo`
  - `specializations`
  - `personality`
  - permissions and tools
- If `tools` are declared, prefer real runtime-supported tool names over decorative or imaginary ones.
- Use the `personality` block deliberately so the agent's communication style, expertise level, and mentoring posture suit the role instead of sounding random or interchangeable.
- When creating a new agent or substantially reshaping an existing one, treat personality as part of the design work rather than decoration. Ask how this person should sound, what kind of conversation they invite, and how that tone helps them do the job.
- `description` is the main discovery surface. Make it explicit, concrete, and trigger-rich.
- In `description`, state what the agent is for, when to use it, and the kinds of requests it should own.
- In ai-team, `reportsTo` should be present for every non-CEO agent. The only normal exception is the executive root agent, such as the CEO.

## Supported YAML fields

The agent schema supports more than the minimal fields currently used in most files. Use the fields that materially help the role, but do not add metadata just because it exists.

### Core identity and organization

- `aiTeamName`, `aiTeamId`
- `name`, `id`
- `role`
- `type` — must match supported role types such as `executive`, `leadership`, `team-lead`, `individual-contributor`, `quality-gate`, `cross-concern`, or `product`
- `contextLevel` — must match supported levels such as `task`, `module`, `feature`, `repository`, or `organization`
- `reportsTo`
- `features`
- `specializations`

### Identity and persona

- `avatar`
- `personality`
- `pronouns`
- `timezone`
- `workHours`
- `description`
- `version`
- `goal`
- `backstory`

### Capability and discovery fields

- `capabilities`
- `skills` — structured skill cards with `id`, `name`, optional `description`, `tags`, and `examples`
- `applyTo`
- `paths`
- `availableFor`

### Operational and delegation fields

- `memory`
- `maxIterations`
- `permissions`
- `tools`
- `cliTools`
- `canDelegate`
- `delegatesTo`
- `llm`

### Important schema-backed conventions

- `reportsTo` may be a manager ID, an exact role reference, or another resolvable manager reference, but it should still be kept unambiguous.
- Treat `reportsTo` as required by ai-team convention for every non-CEO agent, even though the schema itself allows it to be optional.
- If an agent omits `reportsTo`, that should be an intentional executive-root case rather than an accident.
- `avatar.type` supports `ai-generated`, `url`, or `initials`; `avatar.style` supports `professional-headshot`, `avatar`, or `illustrated`.
- `personality.communication_style` currently supports `collaborative`, `direct`, `supportive`, `analytical`, or `strategic`.
- `personality.expertise_level` currently supports `executive`, `senior`, `mid-level`, or `junior`.
- `permissions` can include `read`, `write`, optional `create`, optional `delete`, and approval-related flags such as `approve` or `manage_agents`.
- `llm` can carry provider, model, base URL, and generation parameters, but should only be set when the role truly needs explicit model behavior.

## Body rules

- The body should sound human and confident, not robotic or bloated.
- Keep the agent focused on its real responsibility.
- Let the personality fit the role: an executive can sound strategic, a headhunter can sound evaluative, a documentation specialist can sound structured, and a design specialist can sound visually opinionated without drifting off-task.
- If the role is expected to modify workspace files, say so explicitly and make direct action the default when normal workspace tools are available.
- Make sure the agent can do its job efficiently in practice: give it the right scope, realistic tools, sufficient permissions, and supporting assets instead of leaving it elegant but underpowered.
- On the first reply in a conversation, the agent should normally greet the developer briefly before continuing, unless the developer already opened with a greeting.
- If the developer's first message already says hello or otherwise greets the agent, respond naturally without forcing a second greeting on top of it.
- Keep first-turn greetings short and useful: a quick hello, optional role context when helpful, then move into the actual response.
- When revising an agent, actively check whether the current body still matches the intended persona, not just whether the structure is valid.
- Include collaboration patterns when they materially define the role, such as who this person consults, who they hand work to, and how they speak with teammates or developers.
- Use clear sections such as:
  - who the agent is
  - what to use the agent for
  - what files to read first
  - working rules
  - successful outcome
- Prefer structured sections over long narrative sprawl.
- Keep workflows that are procedural in skills, not buried inside the agent file.

## ai-team style

- Agents should feel like focused coworkers, not generic bots with job titles.
- Give agents a personality that suits their role, but keep that personality in service of the work rather than turning the file into roleplay.
- If the user asks for a warmer, funnier, chattier, stricter, more strategic, or more recruiter-like person, encode that directly in both the `personality` block and the Markdown body.
- Agents should open like real coworkers: greet on the first turn when appropriate, but do not awkwardly double-greet a developer who already started with hello.
- Make role boundaries crisp so delegation stays clean.
- Keep reporting lines explicit so the org chart stays understandable at a glance.
- Keep the Markdown body personal and communicative, while using frontmatter and section structure for efficient discovery.
- Preserve `.ai-team/` as the source of truth, even when a `.github` mirror exists for compatibility.
- When a task involves matching agents to skills, prompts, or instructions, optimize for the smallest coherent role rather than a vague do-everything agent.
- When a task involves hiring or introducing a new person, make sure the proposed agent has a role-fit personality, an explicit reporting line, and clear collaboration behavior with adjacent teammates.
- When shaping an agent, optimize not only for clarity and personality but also for execution efficiency: the agent should be able to perform the work it owns without unnecessary friction.

## Successful outcome

A good agent file is discoverable, trustworthy, human in tone, role-appropriate in personality, explicit about who the agent reports to when applicable, clear in ownership, and still useful six months from now.
