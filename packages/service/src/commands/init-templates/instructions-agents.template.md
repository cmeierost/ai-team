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
- Put ai-team runtime-specific metadata such as permissions, tools, and other operational fields in the sibling `.agent.yml` sidecar instead of the Markdown portfolio.
- Keep discovery-facing fields sharp and intentional, especially:
  - `name`
  - `description`
- `description` is the main discovery surface. Make it explicit, concrete, and trigger-rich.

## Body rules

- The body should sound human and confident, not robotic or bloated.
- Keep the agent focused on its real responsibility.
- Include collaboration patterns when they materially define the role.
- Use clear sections such as who the agent is, what to use the agent for, what files to read first, working rules, and successful outcome.
- Keep workflows that are procedural in skills, not buried inside the agent file.

## Successful outcome

A good agent portfolio markdown file is discoverable, trustworthy, human in tone, role-appropriate in personality, clear in ownership, and cleanly separated from ai-team runtime metadata.
