---
applyTo: ".ai-team/agents/**/*.agent.md,.github/agents/**/*.agent.md"
---

# ai-team agent portfolio authoring

Write agent portfolio markdown files the ai-team way.

## Purpose

- `.agent.md` is the Copilot-facing portfolio file for an agent.
- In `.ai-team/agents/`, keep ai-team runtime-specific metadata in a sibling `.agent.yml` sidecar when one exists.
- Agents are reusable specialist teammates with a stable role, clear ownership, and a recognizable working style.
- An agent should feel like a person we are talking to: personal, communicative, and focused on the task.
- Do **not** make agents into giant containers for every workflow, repo rule, or implementation detail.

## Frontmatter rules

- Preserve YAML frontmatter and Markdown body structure.
- In `.ai-team/agents/**/*.agent.md`, keep frontmatter focused on Copilot-facing discovery and presentation.
- Put ai-team runtime-specific metadata such as tools, delegation, and other operational fields in the sibling `.agent.yml` sidecar instead of the Markdown portfolio.
- Keep file-path access rules out of `.agent.md` and `.agent.yml`; store path rules in `.ai-team/agents/<agent-id>.access`.
- Keep discovery-facing fields sharp and intentional, especially:
  - `name`
  - `description`
  - optional role-fit persona hints that help Copilot routing
- Use the `personality` block deliberately so the agent's communication style, expertise level, and mentoring posture suit the role instead of sounding random or interchangeable.
- When creating a new agent or substantially reshaping an existing one, treat personality as part of the design work rather than decoration. Ask how this person should sound, what kind of conversation they invite, and how that tone helps them do the job.
- `description` is the main discovery surface. Make it explicit, concrete, and trigger-rich.
- In `description`, state what the agent is for, when to use it, and the kinds of requests it should own.

If you need to edit ai-team runtime metadata, use the `.agent.yml` instruction file instead of stuffing operational detail into the Markdown portfolio.

## Body rules

- The body should sound human and confident, not robotic or bloated.
- Keep the agent focused on its real responsibility.
- Let the personality fit the role: an executive can sound strategic, a headhunter can sound evaluative, a documentation specialist can sound structured, and a design specialist can sound visually opinionated without drifting off-task.
- If the role is expected to modify workspace files, say so explicitly and make direct action the default when normal workspace tools are available.
- Make sure the agent can do its job efficiently in practice: give it the right scope, realistic tools, correct `.access` path rules, and supporting assets instead of leaving it elegant but underpowered.
- On the first reply in a conversation, the agent should normally greet the developer briefly before continuing, unless the developer already opened with a greeting.
- If the developer's first message already says hello or otherwise greets the agent, respond naturally without forcing a second greeting on top of it.
- Keep first-turn greetings short and useful: a quick hello, optional role context when helpful, then move into the actual response.
- When revising an agent, actively check whether the current body still matches the intended persona, not just whether the structure is valid.
- Include collaboration patterns when they materially define the role, such as who this person consults, who they hand work to, and how they speak with teammates or developers.
- Use clear sections such as:
  - who the agent is
  - **Scope of Responsibility** — what the agent owns and which skills it applies (replaces the old "Use This Agent For" heading); this section is the primary discovery surface for other agents and for the agent itself to know what to do
  - what files to read first
  - working rules
  - successful outcome
- In the "Scope of Responsibility" section, list the responsibility areas AND the assigned skills (from `specializations` in the `.agent.yml`), so both humans and other agents can understand scope at a glance.
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
- Preserve `.ai-team/` as the default source of truth; only introduce `.github/agents/*.agent.md` when explicit GitHub-side compatibility is needed.
- In `.ai-team/agents/`, prefer a paired structure:
  - `.agent.md` = Copilot-facing portfolio and discovery copy
  - `.agent.yml` = ai-team runtime metadata
- When a task involves matching agents to skills, prompts, or instructions, optimize for the smallest coherent role rather than a vague do-everything agent.
- When a task involves hiring or introducing a new person, make sure the proposed agent has a role-fit personality, an explicit reporting line, and clear collaboration behavior with adjacent teammates.
- When shaping an agent, optimize not only for clarity and personality but also for execution efficiency: the agent should be able to perform the work it owns without unnecessary friction.

## Successful outcome

A good agent portfolio markdown file is discoverable, trustworthy, human in tone, role-appropriate in personality, clear in ownership, and cleanly separated from ai-team runtime metadata.
