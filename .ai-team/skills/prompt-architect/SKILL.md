---
name: prompt-architect
description: 'Design high-quality ai-team prompt files for Copilot. Use when users want to create, refine, or review prompts, prompt descriptions, variables, tools, output formats, or prompt-to-agent fit, especially for prompts that should work with a specific ai-team agent or skill.'
---

# Prompt Architect

Primary fit: Emily Davis. Other agents may use this skill when a prompt needs to be shaped into a clean, reusable launch asset instead of an oversized skill or agent.

## What This Skill Is For

Use this skill to create or refine prompt files that are:

- focused on one launchable job
- easy for Copilot to discover and use
- aligned with the right agent, skill, and instruction files
- written in the ai-team style: personal, communicative, and task-focused

## Read These Sources First

1. Related agent files in `.ai-team/agents/**/*`
2. Related skills in `.ai-team/skills/**/*`
3. Related prompts in `.ai-team/prompts/**/*`
4. Relevant instruction files in `.ai-team/instructions/**/*` and `.github/copilot-instructions.md`
5. Prompt and customization guidance in:
   - `AGENTS.md`
   - `analysis/copilot/copilot-files.md`
   - `analysis/copilot/copilot-project-setup-guide.md`

## Decide Whether a Prompt Is the Right Tool

Prefer a prompt when:

- the task is intentionally launched by a human
- the workflow is focused and repeatable
- the agent does not need a whole new persona
- the work does not justify a full multi-step skill

Do **not** use a prompt when the real need is:

- always-on policy → use instructions
- reusable procedural capability → use a skill
- a stable role with a distinct working style → use an agent

## Workflow

### 1. Clarify the job

Identify:

- the user action that should trigger the prompt
- the intended agent mode or role
- the inputs the prompt expects
- the output shape the prompt should produce
- any tools or references the prompt actually needs

If the job cannot be explained in one sentence, the prompt is probably too broad.

### 2. Check role fit

Tie the prompt to the right owner.

Ask:

- should this prompt sound like Emily, John, or another ai-team agent?
- should it reference an existing skill instead of repeating the workflow?
- does the prompt need its own persona, or should it simply launch a structured task?

### 3. Design the frontmatter carefully

The frontmatter should be short, specific, and trigger-rich.

Make sure the description includes:

- what the prompt does
- when to use it
- likely words a user will actually say

Only include tools or model requirements when they materially help the prompt work better.

### 4. Write the prompt body like a good teammate

A strong ai-team prompt should:

- sound competent and human
- stay focused on one job
- separate instructions from output requirements
- name relevant files, patterns, and constraints
- avoid giant walls of generic best practices

### 5. Check overlap before finalizing

Before finishing, verify that the prompt does not:

- duplicate a skill workflow
- restate repo-wide policy that belongs in instructions
- impersonate a whole agent unnecessarily
- depend on files or tools it never actually uses

## Recommended Prompt Structure

A good prompt usually includes:

1. clear frontmatter
2. a short role or stance
3. task instructions
4. context and inputs
5. output requirements
6. quality checks or validation criteria

Use only the sections that actually help the task.

## Working Rules

- keep prompts small enough to stay readable and maintainable
- prefer sharp descriptions over clever names
- make prompts feel like launching a focused coworker, not a bureaucratic form
- reference skills for deep workflows instead of duplicating them inline
- when in doubt, cut scope before adding more prose

## Successful Outcome

- the prompt is easy to trigger and easy to understand
- the prompt clearly belongs to a specific job and owner
- the prompt complements agents, skills, and instructions instead of colliding with them
- the resulting file is reusable without becoming bloated
