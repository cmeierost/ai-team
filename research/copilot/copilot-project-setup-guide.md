# Guide: Setting Up a Project to Work Efficiently with Copilot

This guide describes how to structure a repository so **GitHub Copilot** and **VS Code Copilot** can work with high relevance, low friction, and minimal wasted context.

It is based on current official documentation reviewed in March 2026 and tuned for practical use in real repositories.

---

## 1. Goals

An efficient Copilot-ready project should make it easy for Copilot to:

- understand what the repository does
- find the right files quickly
- follow the project's architectural boundaries
- run the correct validation commands in the correct order
- avoid unnecessary exploration
- use the right customization layer for each kind of guidance

The ideal result is:

> less searching, fewer wrong assumptions, fewer broken builds, and better first-pass changes.

---

## 2. Start with the Minimum Effective Baseline

The most effective baseline is:

1. one small project-wide instructions file
2. a small number of targeted path-specific instructions
3. a few reusable workflows as prompt files or skills
4. optional custom agents for specialized roles

Do **not** start by creating a giant all-purpose Copilot document. That usually increases noise instead of improving performance.

---

## 3. Put the Right Information in the Right Layer

## 3.1. Project-wide instructions

Use a project-wide instructions file for information that matters on almost every task.

Best content:

- repository purpose
- package/module boundaries
- preferred libraries and forbidden libraries
- coding standards that are not obvious from linting alone
- validation commands and command order
- security or data-handling constraints

Avoid:

- long tutorials
- repeated examples for every framework feature
- information that a formatter or linter already enforces

For GitHub compatibility, this is usually:

- `.github/copilot-instructions.md`

For VS Code, it can also be complemented by:

- `AGENTS.md`
- configured custom discovery locations

---

## 3.2. Path-specific instructions

Use `*.instructions.md` files when different parts of the repo follow different rules.

Examples:

- frontend vs backend conventions
- test file rules
- TypeScript strictness rules
- package-specific framework patterns

Good examples of scoping:

- `**/*.ts`
- `packages/web/src/**/*`
- `packages/core/src/**/*`
- `**/*.test.ts`

This is especially valuable in monorepos.

---

## 3.3. Prompt files

Use prompt files for repeatable manual workflows.

Examples:

- generate a PR summary
- scaffold a new command
- create unit tests for a selected file
- build a verification checklist for a package

Prompt files are best when:

- the task is initiated intentionally by a human
- the workflow is repeatable
- the workflow benefits from structured inputs and outputs

---

## 3.4. Skills

Use skills for multi-step capabilities that should load only when relevant.

Examples:

- debug failing CI
- validate a monorepo after code changes
- add a CLI command correctly
- work on storage/frontmatter files safely

Skills are better than giant instructions because they use progressive disclosure:

1. Copilot sees only the skill name and description at discovery time
2. it loads the full `SKILL.md` only when relevant
3. it loads extra resources only if needed

This keeps context usage efficient.

---

## 3.5. Custom agents

Use custom agents when the role or allowed tool set should change.

Examples:

- reviewer agent with read-only tools
- planner agent focused on research and plan generation
- docs agent optimized for explanation and structure
- implementation agent with edit and terminal tools

Custom agents help when the same project needs different working modes.

---

## 4. Keep Instructions Short and High Signal

Official guidance strongly favors concise instructions.

Good instruction characteristics:

- short
- specific
- non-obvious
- actionable
- supported by rationale when helpful

Good:

- Use `zod` for external/untrusted input validation.
- Keep `packages/core` UI-free; do not import `vscode`, `react`, or `electron` there.
- For CLI command changes, run the package build and relevant Vitest command before finishing.

Less good:

- Write good code.
- Use best practices.
- Be clean and maintainable.

Those sound nice, but they are mushy prompt salad.

---

## 5. Tell Copilot How to Verify Work

One of the highest-value things you can do is document the **exact validation flow**.

Include:

- install/bootstrap command
- package-specific build commands
- package-specific test commands
- lint commands
- when to use whole-repo validation
- any required command order
- known pitfalls and workarounds

Example categories to document:

- build all packages
- build only changed package
- run package-local tests
- run lint
- run manual verification for web/UI work

If a repository has hidden gotchas, write them down explicitly.

---

## 6. Document Architecture as Navigation, Not as Novel Writing

Copilot performs better when architecture docs answer:

- what are the main packages?
- what belongs where?
- what must not cross boundaries?
- where should new code go?
- what files are the entry points?
- what validations apply when a shared contract changes?

This kind of map is better than long theory sections.

Useful content:

- package purpose
- allowed dependencies
- key entry files
- key config files
- safe edit zones
- boundary rules

---

## 7. Optimize for Monorepos Explicitly

In monorepos, Copilot benefits from explicit folder-level guidance.

Recommended setup:

- one repo-wide instructions file
- several path-specific instruction files
- package-focused skills for high-risk workflows

Examples:

- `core.instructions.md`
- `web.instructions.md`
- `cli.instructions.md`
- `tests.instructions.md`

This prevents backend rules from polluting frontend tasks and vice versa.

---

## 8. Prefer `.ai-team/` as Source of Truth, Use `.github/` as Bootstrap When Needed

If you want your project intelligence to live in `.ai-team/`, that is a good architecture.

Recommended model:

- `.ai-team/` contains the substantial docs, workflows, skills, prompts, and operational guidance
- `.github/` contains only the thin compatibility entry points required for discovery

Why this works:

- VS Code can be configured to discover customization files from non-default paths
- GitHub-side Copilot still expects some conventional locations, especially `.github/copilot-instructions.md`

Best practice:

- keep `.github/copilot-instructions.md` short
- point it to authoritative `.ai-team/` files
- avoid duplicating large sections across both locations

---

## 9. Use the Newer Copilot Workflow Features Intentionally

Current docs emphasize that the most efficient Copilot usage is not just “ask one giant prompt.”

A strong workflow is:

1. **Explore**
   - use ask/chat for understanding the codebase
2. **Plan**
   - use a planning agent or planning-oriented prompt for cross-file changes
3. **Implement**
   - use agent mode or implementation-oriented prompt files
4. **Review and verify**
   - review diffs, run tests, and use checkpoints or code review workflows

This is especially effective for large or cross-cutting changes.

---

## 10. Choose the Right Model and Interaction Surface

Official guidance recommends matching model and mode to task.

### Good default mapping

- **inline suggestions**: boilerplate, local edits, staying in flow
- **ask/chat**: questions, architecture understanding, exploration
- **inline chat**: targeted in-file changes
- **agent mode**: multi-file implementation
- **plan mode**: migrations, refactors, architecture changes

### Model guidance

- use faster models for routine edits and boilerplate
- use stronger reasoning models for debugging, planning, architecture, and code review
- if output quality is poor, try a different model before rewriting the whole repo structure around one bad result

---

## 11. Keep Context Clean

Copilot quality degrades when sessions accumulate unrelated history.

Best practices:

- start a new session for unrelated tasks
- remove stale context where supported
- reference exact files, folders, or symbols when the task is ambiguous
- attach only relevant context
- use subagents or isolated workflows for side investigations

Context pollution is one of the sneakiest ways to make Copilot look dumber than it is.

---

## 12. Keep Shared Skills and Agents Auditable

If you adopt community skills, prompts, or agents:

- review them before installing
- verify what tools they can use
- confirm any scripts are safe
- adapt them to project-specific rules
- prefer small, auditable skill directories over giant black boxes

Treat third-party customizations as code, not decoration.

---

## 13. A Practical Setup Checklist

Use this as a starting checklist for a Copilot-efficient project.

### Minimum useful setup

- [ ] Create a small project-wide instructions file
- [ ] Document exact build, test, and lint commands
- [ ] Document package/module boundaries
- [ ] Add path-specific instruction files for parts of the repo with different rules
- [ ] Add one or two prompt files for repeated workflows

### Better setup for medium/large repos

- [ ] Add skills for high-friction workflows
- [ ] Add a reviewer custom agent
- [ ] Add a planner custom agent
- [ ] Add package-specific verification guidance
- [ ] Add links from the bootstrap file to deeper docs

### Better setup for monorepos

- [ ] Split instructions by package or layer
- [ ] Write a validation matrix by package
- [ ] Add skills for cross-package changes
- [ ] Explicitly document shared contracts and their validation requirements

---

## 14. Recommended Setup for This Repository

For `ai-team`, a strong setup would be:

- `.github/copilot-instructions.md`
  - thin bootstrap file
- `.ai-team/instructions/`
  - monorepo boundaries
  - TypeScript rules
  - package-specific conventions
- `.ai-team/skills/`
  - monorepo validation
  - CLI command workflow
  - storage/frontmatter editing
  - cross-package contract change workflow
- `.ai-team/prompts/`
  - fix failing test
  - add CLI command
  - prepare PR summary
- `.ai-team/agents/`
  - reviewer
  - planner

This would keep the repo highly usable for Copilot without making `.github/` the main long-term knowledge store.

---

## 15. Bottom Line

To make a project work as efficiently as possible with Copilot:

- keep global instructions short and high-value
- document exact validation steps
- split rules by file/package when needed
- use skills for on-demand workflows
- use prompt files for repeatable manual tasks
- use custom agents for role-based behavior
- keep architecture docs navigational and actionable
- keep `.ai-team/` as the real knowledge base if that matches your project design
- keep a thin `.github/` bootstrap layer for compatibility where needed

The best Copilot setup is not the biggest one.

It is the one that gives the model the **right information at the right time with the least noise**.

---

## 16. Source Basis

This guide is based on the official documentation reviewed in March 2026, including:

- GitHub Copilot get started and best practices docs
- GitHub custom instructions docs
- GitHub Copilot agent and skills docs
- VS Code Copilot overview, chat, customization, prompt files, custom agents, and skills docs
- Agent Skills open specification at `agentskills.io`

Community sources were used for examples and ecosystem patterns, especially:

- `github/awesome-copilot`
- `anthropics/skills`

Official docs should be treated as the source of truth for supported file locations and product behavior.
