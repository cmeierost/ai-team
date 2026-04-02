# Copilot Files, Discovery Rules, and `.ai-team` Strategy

This document captures the current state of **GitHub Copilot** and **VS Code Copilot** file-based customization, with special focus on whether project knowledge can live primarily under `.ai-team/` instead of `.github/`.

It summarizes the official documentation reviewed in March 2026 and turns it into implementation guidance for this repository.

---

## 1. Why This Matters

Copilot quality depends heavily on what configuration and guidance files it can discover automatically.

For this repository, we want to:

- keep durable project knowledge in `.ai-team/`
- avoid overloading `.github/` with long-lived operational docs
- stay compatible with current Copilot discovery behavior in:
  - VS Code
  - GitHub.com / Copilot Chat on GitHub
  - GitHub Copilot coding agent
  - GitHub Copilot CLI

The key question is:

> Can Copilot be told to look primarily in `.ai-team/` instead of `.github/`?

The answer is **partially yes in VS Code**, but **not fully on GitHub/Copilot coding agent today**.

---

## 2. Main Copilot File Types

Current official docs describe several separate customization layers.

### 2.1. Always-on instructions

Used for project-wide rules, coding standards, architecture constraints, and validation guidance.

Common files:

- `.github/copilot-instructions.md`
- `AGENTS.md`
- `CLAUDE.md`
- organization-level instruction sources

### 2.2. Path-specific instructions

Used when rules should apply only to certain files or folders.

Common files:

- `.github/instructions/*.instructions.md`

These usually include frontmatter like `applyTo: "**/*.ts"`.

### 2.3. Prompt files

Reusable slash-command tasks.

Common files:

- `.github/prompts/*.prompt.md`

Examples:

- scaffold a component
- run and fix tests
- generate release notes

### 2.4. Custom agents

Role-specific personas with tool restrictions and optional handoffs.

Common files:

- `.github/agents/*.agent.md`

Examples:

- reviewer
- planner
- documentation writer
- security auditor

### 2.5. Skills

Portable, task-specific capability folders containing instructions plus optional resources.

Common files:

- `.github/skills/<skill-name>/SKILL.md`
- optional sibling files under that skill directory such as `scripts/`, `references/`, or `assets/`

Skills are intended for repeatable workflows, not general repository policy.

---

## 3. Discovery Rules by Environment

## 3.1. VS Code Copilot

VS Code is the most flexible environment.

Official docs indicate support for these default file types and locations:

- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- `.github/prompts/*.prompt.md`
- `.github/agents/*.agent.md`
- `.github/skills/<skill>/SKILL.md`
- `AGENTS.md`
- `CLAUDE.md`
- organization-level customizations
- user-profile customizations

### Important VS Code detail

VS Code supports **custom discovery locations** for several categories:

- instructions: `chat.instructionsFilesLocations`
- prompt files: `chat.promptFilesLocations`
- custom agents: `chat.agentFilesLocations`
- skills: `chat.agentSkillsLocations`

This means VS Code can be configured to load customization files from non-default folders, including a structure centered around `.ai-team/`.

### Practical implication

If this project mainly optimizes for **VS Code Copilot**, then `.ai-team/` can be the primary home for:

- instructions
- prompts
- agents
- skills

with editor settings pointing discovery there.

### Important limitation

The VS Code docs also note that **custom instructions are not used for inline suggestions**. They primarily affect chat/agent experiences.

---

## 3.2. GitHub.com Copilot / repository custom instructions

GitHub-side Copilot is more opinionated about locations.

Official docs currently describe these repository-level entry points:

- `.github/copilot-instructions.md` for repository-wide custom instructions
- `.github/instructions/*.instructions.md` for path-specific custom instructions
- `AGENTS.md` files for agent instructions
- `CLAUDE.md` or `GEMINI.md` in supported locations for agent ecosystems

For repository custom instructions on GitHub.com, `.github/copilot-instructions.md` remains the canonical project-wide file.

### Practical implication

If we want strong compatibility with **Copilot on GitHub**, we should continue to provide:

- `.github/copilot-instructions.md`

Even if most real documentation lives elsewhere.

---

## 3.3. GitHub Copilot coding agent

Official docs indicate support for:

- repository custom instructions in `.github/copilot-instructions.md`
- path-specific instructions under `.github/instructions/`
- `AGENTS.md`
- skills in `.github/skills/` or `.claude/skills/`
- agent-related compatibility files like `CLAUDE.md` and `GEMINI.md`

GitHub docs also note that, for `AGENTS.md`, the nearest file in the directory tree can take precedence in some agent scenarios.

### Practical implication

For **coding agent compatibility**, `.github/` is still an important bootstrap area.

There is no documented GitHub-side equivalent of VS Code's arbitrary custom discovery settings for moving everything to `.ai-team/`.

---

## 3.4. GitHub Copilot CLI

Official CLI docs support:

- project skills in `.github/skills/` or `.claude/skills/`
- personal skills in `~/.copilot/skills/` or `~/.claude/skills/`
- CLI-specific customizations, agents, hooks, plugins, and skills

Skills are loaded based on their descriptions and can also be invoked directly with slash commands.

### Practical implication

For CLI portability, `.github/skills/` remains a safe repository-level location.

---

## 4. Can `.ai-team/` Be the Primary Home?

## 4.1. Short answer

### Yes, if the primary target is VS Code

VS Code has configurable discovery locations, so `.ai-team/` can become the main source of truth.

### Not fully, if GitHub/Copilot coding agent must work without extra setup

GitHub-side features still officially center many repository customizations around `.github/` and a small number of conventional files like `AGENTS.md`.

---

## 4.2. Best interpretation

The safest current model is:

- **`.ai-team/` = source of truth**
- **`.github/` = compatibility and discovery shim**

This gives us the structure we want without fighting the platform.

---

## 5. Recommended Strategy for This Repository

## 5.1. Make `.ai-team/` the authoritative knowledge base

Use `.ai-team/` for the substantial content we want humans and agents to follow.

Recommended areas:

- `.ai-team/instructions/`
- `.ai-team/skills/`
- `.ai-team/agents/`
- `.ai-team/prompts/`
- `.ai-team/context/`
- `.ai-team/workflows/`

Good candidates for `.ai-team/` content:

- architecture and package boundaries
- validation/build/test/lint sequences
- monorepo workflows
- storage/frontmatter conventions
- cross-package contract update procedures
- agent-specific operational guidance

---

## 5.2. Keep `.github/` minimal and thin

Use `.github/` mainly for discovery and compatibility.

Recommended thin files:

- `.github/copilot-instructions.md`
- possibly `.github/instructions/*.instructions.md` only where GitHub-specific path matching is useful
- possibly `.github/skills/` only when a repository-local skill must be auto-discoverable without extra config

### What thin means here

A thin compatibility file should:

- be short
- explain that authoritative project guidance lives under `.ai-team/`
- link to the relevant `.ai-team/` files
- avoid duplicating large bodies of operational knowledge

This prevents drift between `.github/` and `.ai-team/`.

---

## 5.3. Use `AGENTS.md` as an additional bridge when useful

Because `AGENTS.md` is recognized across multiple agent-oriented workflows, it can serve as a second bootstrap file.

Recommended use:

- brief repo summary
- pointer to `.ai-team/` as source of truth
- instruction to trust `.ai-team/` workflow docs before broad searching

This helps steer agents away from treating `.github/` as the place where all substantive content must live.

---

## 6. Suggested File Layout

A practical repository layout would be:

```text
.ai-team/
  context/
    repo-overview.md
    architecture-map.md
    validation-matrix.md
  instructions/
    monorepo.instructions.md
    typescript.instructions.md
    testing.instructions.md
  skills/
    monorepo-validation/
      SKILL.md
    cli-command-workflow/
      SKILL.md
    core-storage-editing/
      SKILL.md
  agents/
    reviewer.agent.md
    planner.agent.md
  prompts/
    fix-failing-test.prompt.md
    add-cli-command.prompt.md

.github/
  copilot-instructions.md
  instructions/
    optional thin GitHub-specific shims
```

---

## 7. What Should Go Where

## 7.1. Put in `.github/copilot-instructions.md`

Only information that needs to be discovered immediately and universally by GitHub-side Copilot.

Recommended contents:

- short repo summary
- short package map
- short verification entry points
- explicit instruction that detailed guidance lives in `.ai-team/`
- direct links to key `.ai-team/` docs

Avoid putting:

- long workflow narratives
- duplicated architecture docs
- large checklists better handled as skills or prompt files

---

## 7.2. Put in `.ai-team/instructions/`

Use for durable rules and conventions such as:

- TypeScript strictness expectations
- package boundaries
- adapter/core separation
- documentation standards
- test placement rules

These are better here because they are repository knowledge, not GitHub-bootstrap boilerplate.

---

## 7.3. Put in `.ai-team/skills/`

Use for multi-step workflows such as:

- validating the monorepo after changes
- adding a new CLI command
- editing storage Markdown/frontmatter safely
- debugging failing GitHub Actions or builds

Skills are a better fit than giant instructions because they load on demand.

---

## 7.4. Put in `.ai-team/prompts/`

Use for manual, repeatable slash-command tasks, such as:

- generating a package-level verification checklist
- scaffolding a new package feature
- preparing a PR summary
- creating a test plan

---

## 7.5. Put in `.ai-team/agents/`

Use for role-based behavior where tools or workflow posture should differ, such as:

- read-only reviewer
- planner
- documentation editor
- refactor specialist

---

## 8. Recommended Wording for the Compatibility Layer

A good `.github/copilot-instructions.md` should not try to contain the whole repository brain.

Instead, it should communicate:

- this is a TypeScript monorepo
- authoritative operational guidance lives in `.ai-team/`
- before broad searching, consult the linked `.ai-team/` files for architecture, validation, and workflow rules
- use `.github/` docs as bootstrap metadata, not the primary knowledge base

That pattern preserves compatibility while nudging Copilot toward the project-specific structure we want.

---

## 9. Current Recommendation for `ai-team`

For this repository, the recommended direction is:

1. Keep `.ai-team/` as the **main knowledge and workflow layer**.
2. Keep `.github/copilot-instructions.md` as a **thin entry point** for GitHub-side discovery.
3. Use `.ai-team/skills/` for task-specific workflows instead of overloading one large instructions file.
4. Optionally configure VS Code discovery settings so instructions, prompts, agents, and skills can be discovered directly from `.ai-team/`.
5. Avoid duplicating large content across `.github/` and `.ai-team/`; prefer links and short summaries in `.github/`.

---

## 10. Bottom Line

If the goal is to tell Copilot not to look primarily in `.github/`:

- **VS Code:** yes, mostly achievable through custom discovery settings and a `.ai-team/`-first layout.
- **GitHub.com / Copilot coding agent:** not completely; keep a thin `.github` compatibility layer.

So the best current architecture is:

> **`.ai-team/` for truth, `.github/` for discovery bootstrap.**

This matches current platform behavior while preserving the repository structure we actually want.

---

## 11. Source Basis

This document is based on the official documentation reviewed in March 2026, including:

- GitHub Copilot documentation
- GitHub custom instructions documentation
- GitHub skills documentation
- VS Code Copilot overview and customization documentation
- VS Code custom instructions, prompt files, custom agents, and skills documentation
- Agent Skills open specification at `agentskills.io`

It also incorporates community ecosystem signals from:

- `github/awesome-copilot`
- `anthropics/skills`

These community sources are useful for patterns and examples, but official discovery and compatibility behavior should be taken from the GitHub and VS Code documentation first.
