---
applyTo: ".ai-team/prompts/**/*.prompt.md,.github/prompts/**/*.prompt.md"
---

# ai-team prompt authoring

Write prompts the ai-team way.

## Purpose

- Prompts are **human-launched task starters**.
- Use a prompt for a focused, repeatable request that someone intentionally invokes.
- Do **not** use a prompt as a substitute for a full skill, a standing policy file, or a whole custom agent persona.

## Scope rules

- Keep each prompt focused on one job or one closely related workflow.
- If the prompt needs lots of procedural detail, move the deeper workflow into a skill and let the prompt launch it.
- If the prompt starts describing permanent role behavior, move that guidance into an agent file.

## Frontmatter rules

- `description` should clearly say what the prompt does and when to use it.
- Include likely trigger phrases users might actually type.
- Only specify tools, model hints, or other metadata when they genuinely improve reliability.
- Keep frontmatter lean; do not cram the whole prompt into metadata.

## Body rules

- Prompts should feel personal, communicative, and task-focused.
- Write like you are launching a capable coworker, not filling out a compliance template.
- Separate:
  - task
  - context or inputs
  - output expectations
  - validation or quality checks
- Use only the sections that materially help the task.
- Avoid repeating repo-wide policy or copying whole skill workflows inline.

## ai-team style

- Keep the voice warm, clear, and focused.
- Avoid generic filler such as “follow best practices” unless you also say what that means here.
- Prefer sharp instructions and reusable structure over long, theatrical prose.
- Make sure the prompt fits the right owner, skill, and instruction context instead of colliding with them.
- Use `.ai-team/prompts/` as the default home; only mirror a prompt into `.github/prompts/` when explicit GitHub-side compatibility is needed.

## Successful outcome

A good prompt is easy to trigger, easy to understand, tightly scoped, and clearly complements nearby agents, skills, and instructions.
