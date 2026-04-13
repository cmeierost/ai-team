---
applyTo: '.ai-team/tasks/**/*.md'
---

# AI Team Task Planning Rules

Use these rules when the user is discussing long-term plans, feature ideas, or working within the `.ai-team/tasks/` directory.

## The `.ai-team/tasks/` Directory

The `.ai-team/tasks/` directory serves as the local feature planning and task tracking system.
It replaces external tools like Jira or GitHub Issues.

## Proactive Planning

- **Protecting Focus (Context Switching)**: If the user brings up a new feature idea, bug, or task while currently in the middle of executing another task in the active session, **you must explicitly suggest** creating a long-term plan for the new idea in `.ai-team/tasks/` instead of mixing it with the current work.
- When you and the user are discussing feature ideas, scopes, or goals that are NOT going to be implemented immediately, **you must proactively ask**: "Do you want to plan this for later in the `.ai-team/tasks/` folder?"
- Do not let good ideas or requirements get lost in the chat history. Offer to save them as a local tracking ticket.

## Execution Behavior

- When the user asks to "start writing a long term plan", "start planning", "start doing planned work", or "what to do next", you should default to inspecting `.ai-team/tasks/`.
- If asked "what are our high priority tasks" or what to do next, check the YAML frontmatter of the files in `.ai-team/tasks/` and suggest the plans with `priority: urgent` or `priority: high`.

## Converting Session Plans to Long-Term Tasks

If the user is working with a short-term plan (e.g., a plan created by a Plan agent or an active session plan) and decides they want to defer it:

1. Extract the title, goal, and the list of steps from the active session plan.
2. Create a new markdown file in `.ai-team/tasks/` following all Frontmatter and file format rules.
3. Map the session plan's step-by-step tasks directly into `- [ ]` checklist items under `## Action Items`.
4. Ask the user for a priority (or infer a reasonable default).

## Action Items and Progress Tracking

- Tasks should be broken down into actionable subtasks using standard markdown checkboxes (`- [ ]`).
- When a subtask is completed by an agent or user, it must be updated to (`- [x]`).
- **CRITICAL:** Anytime an agent updates these checkboxes to track progress, the `updatedAt` field in the frontmatter must be updated to the current ISO date.
- **Task Deletion:** Once all checkboxes are completed and the task/plan is fully done, the agent should proactively ask the user if they want to delete the task file.

## File Naming

The old `<TYPE>-YYYYMMDD-<IDENTIFIER>.md` format is NO LONGER directly necessary.
When creating new tasks, you can use a clear, kebab-cased descriptive name matching the task (e.g., `agent-text-to-speech.md`). Make sure it is saved in `.ai-team/tasks/`.

## File Contents and Frontmatter

Every file must contain a comprehensive YAML frontmatter block, followed by markdown content describing the goals and sub-steps. Even though the filename format is relaxed, the frontmatter must clearly indicate all tracking data.

**CRITICAL NOTE FOR PARSING:** A dedicated Task-UI will read these long-term tasks later. Because of this, strict adherence to the YAML frontmatter format and the `- [ ]` markdown checkboxes structure is mandatory. Do not invent new YAML fields or deviate from the checklist format.

### Required YAML Fields

```markdown
---
id: A descriptive ID or the filename (e.g. agent-text-to-speech)
type: feature # Or bug, doc, chore
title: Brief description of the task
status: todo # Or in_progress, done
priority: low # Or urgent, high, medium
createdBy: human # Or agent
createdByType: human # Or agent
requiresApproval: false
subtaskIds: []
estimatedHours: null
deadline: 2026-04-30T12:00:00.000Z # Optional ISO date, use null if n/a
tags:
  - web
  - ui
createdAt: 2026-04-12T12:00:00.000Z
updatedAt: 2026-04-12T12:00:00.000Z # Must be updated to current time whenever the file is modified
---

## Goal

Provide a plain text description of the goal, context, or vision.

## Action Items

- [ ] Describe sub-tasks or steps here.
- [ ] Include technical constraints.
```

- **`priority` field**: Must be one of `urgent`, `high`, `medium`, or `low`.
- **`createdAt` and `updatedAt`**: You MUST include both exactly as ISO date strings. Modify `updatedAt` whenever you apply modifications to the file.
- **`deadline`**: Assign an ISO date here if time-sensitive or if a deadline is specified, otherwise null.
- **`type` field**: Must still categorize the work correctly (e.g., `feature`, `bug`, `doc`, `chore`).

Always respect the priority listed inside the YAML frontmatter above all else to determine the task's importance.
