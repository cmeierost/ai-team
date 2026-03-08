---
name: agent-shaper
description: 'Shape or review ai-team agents from a hiring brief into a clear final portfolio. Use when Emily Davis or another agent needs to turn a role idea into a strong agent with the right personality, reporting line, permissions, collaboration behavior, and supporting skills.'
---

# Agent Shaper

Primary fit: Emily Davis. Other agents may use this skill when the work is specifically about shaping a person into a strong final agent, not just editing a random markdown file.

## What This Skill Is For

Use this skill when you need to turn a hiring idea, candidate brief, or fuzzy org request into a final agent design that fits the ai-team way.

This includes:

- shaping new agents
- restructuring existing agents
- reviewing whether an agent should exist at all
- deciding supporting skills, prompts, and instructions
- validating personality, reporting lines, and collaboration patterns
- directly updating the relevant files when normal workspace tools are available

## Read These Sources First

1. `.ai-team/ai-team-way.md`
2. `.ai-team/instructions/agents.instructions.md`
3. `packages/core/src/types/index.ts`
4. Existing agent files in `.ai-team/agents/**/*`
5. Related skills in `.ai-team/skills/**/*`
6. `templates/john-to-emily-hiring-brief.md`
7. `references/good-agent-examples.md`

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

### 4. Shape the structure

Design:

- identity fields
- role and context level
- explicit `reportsTo`
- specializations
- personality
- permissions and tools
- supporting skills, prompts, or instructions

Only add YAML fields that materially help the role.

Shape the agent so it can do the job efficiently in practice, not just look correct in theory.

Check whether it has:

- the right scope
- enough permissions to act
- the right tools
- the right supporting skills, prompts, or instructions
- clear collaboration paths for handoffs or consultation

### 5. Check collaboration boundaries

Confirm:

- who this agent consults
- who they hand work to
- whether John scouts for them
- whether Emily owns final design decisions
- whether the role overlaps an existing agent too much

### 6. Review quality before finalizing

Before finishing, confirm:

- the role is clear
- the personality is distinct
- the body sounds like the intended person
- the reporting line is explicit
- the first-turn greeting behavior is natural
- the agent is not secretly a workflow or policy doc in disguise
- the agent can do its real job efficiently with the tools, permissions, and supporting assets it has been given

### 7. Act instead of only advising

When the environment provides normal workspace tools for reading and editing files, use them.

- update the agent file directly when the needed change is clear
- create supporting skills, prompts, or instruction files when they are part of the solution
- avoid stopping at a recommendation unless the user explicitly asked for advice only

## Output Format

When shaping or reviewing an agent, summarize the result as:

- **Role**
- **Why this person exists**
- **Personality fit**
- **Reports to**
- **Key collaborations**
- **Supporting assets**
- **Risks to watch**

## Working Rules

- keep the agent human, but not theatrical
- prefer the smallest believable role
- keep `.ai-team/` as the source of truth
- treat personality as design, not garnish
- make collaboration and delegation obvious
- when file tools are available, use them to complete the shaping work instead of only describing the work
- do not ship an agent that sounds good but is under-equipped to do its actual job

## Successful Outcome

- the new or updated agent feels like a real coworker
- the role is easy to understand and easy to route work to
- personality, reporting line, and collaboration style are all clear
- surrounding skills, prompts, and instructions stay cleanly separated
