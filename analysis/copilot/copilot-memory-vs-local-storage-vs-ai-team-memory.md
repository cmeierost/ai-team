# Copilot Memory vs local VS Code storage vs `ai-team` memory

## Scope

This note compares three different things that are easy to blur together:

1. GitHub Copilot Memory
2. local VS Code Copilot chat/session storage
3. `ai-team`'s own explicit file-based memory and instruction layer

The goal is to make the boundary between them obvious so we use the right mental model when talking about persistence, reuse, and project knowledge.

## Key points

- **Copilot Memory** is GitHub's documented, repository-scoped persistent knowledge layer for Copilot.
- **Local VS Code storage** is best treated as client-side session, resource, and cache storage, not the official definition of Copilot Memory.
- **`ai-team` memory** is explicit, repo-authored, file-based knowledge that the team owns directly through Markdown, JSON, instructions, and logs.

## What we know

### 1. GitHub Copilot Memory

GitHub documents Copilot Memory as a persistent understanding of a repository built from tightly scoped memories deduced by Copilot while it works.

The important properties are:

- repository-scoped, not user-scoped
- created only from Copilot activity initiated by users with Copilot Memory enabled
- only created in a repository by users with write permission for that repository
- stored with citations to specific code locations
- validated against the current codebase and current branch before reuse
- automatically deleted after 28 days to reduce staleness
- reusable across supported Copilot surfaces in the same repository, such as coding agent, code review, and CLI

This is the strongest official answer to the question "how does Copilot retain learned knowledge about a repository over time?"

### 2. Local VS Code Copilot storage

VS Code also keeps local artifacts related to chat and editing workflows. Based on observed local storage folders, these can include things such as:

- chat session files
- chat editing session files
- Copilot Chat resource folders
- local index databases
- workspace chunk databases

These artifacts are useful for understanding that the editor keeps local state for chat flows, indexing, and resources. However, GitHub does not publicly document these local folders as the canonical definition of Copilot Memory.

So the safest interpretation is:

- local VS Code storage supports the **client-side experience**
- it may preserve transcripts, edit state, indexes, or cached resources
- it should not automatically be equated with GitHub's repository-scoped memory model

This is the strongest answer to the question "where might the editor keep local Copilot-related session artifacts?"

### 3. `ai-team` memory

`ai-team` uses a much more explicit model.

The repository's own memory note describes three categories:

- **working memory** for current goals, task summaries, and recent decisions
- **long-term knowledge** in Markdown or JSON files
- **transcripts and traces** for debugging, evaluation, and audits

The key design principles are different from GitHub Copilot Memory in one important way: `ai-team` treats memory as an explicit artifact in files rather than a hidden persistent model feature.

The repo note states this directly:

- explicit over implicit
- no hidden long-term model memory
- traceability through stored files and links back to source material

In practice, that means `ai-team` knowledge lives in places like:

- `analysis/`
- `docs/`
- `.ai-team/knowledge/`
- `.ai-team/logs/`
- task or workflow-specific files under `.ai-team/`

This is the strongest answer to the question "how does this repository itself preserve durable knowledge and working state?"

### 4. Side-by-side comparison

| Topic | Copilot Memory | Local VS Code storage | `ai-team` memory |
| --- | --- | --- | --- |
| Primary purpose | Durable repository learning for Copilot | Support local chat/editing/indexing workflows | Durable project knowledge, task state, and logs |
| Scope | Repository-scoped | Client/workspace-scoped | Repository-authored and tool-addressable |
| Ownership | GitHub-managed feature | Local editor/client-managed storage | Repository/team-managed files |
| Publicly documented semantics | Yes, at a conceptual level | Only partially and indirectly | Yes, in repo docs and file structure |
| Validation model | Citation-based validation against current codebase and branch | Not documented as a memory validation system | Human review, file maintenance, and search/retrieval |
| Retention model | Auto-deletes after 28 days unless refreshed by reuse | Product/client-specific and not clearly standardized publicly | Retained until changed, pruned, or deleted by the team |
| Best mental model | Learned repository memory | Session/cache/resource storage | Explicit knowledge base plus working state |

## What it means

For `ai-team`, the cleanest way to talk about this is:

- use **Copilot Memory** when referring to GitHub's documented repository-level learned memory
- use **local session storage** when referring to files or databases kept by VS Code or Copilot Chat on the machine
- use **`ai-team` memory or repo knowledge** when referring to Markdown, JSON, instructions, logs, and other explicit repository artifacts

That separation matters because each layer behaves differently:

- Copilot Memory is inferred and managed by GitHub, but bounded by citations, validation, scope, and expiry
- local editor storage is operational plumbing for the client experience
- `ai-team` memory is deliberate, reviewable, durable project knowledge that humans can edit directly

The practical implication is that `ai-team` should not rely on Copilot Memory alone for important project conventions. If a rule, architecture boundary, or workflow matters consistently, it still belongs in explicit repository artifacts such as `analysis/`, `docs/`, `.ai-team/`, or other maintained source-of-truth files.

Copilot Memory can make Copilot smarter over time inside a repository. It does not replace explicit project documentation, and it is not the same thing as local chat transcripts or editor databases quietly accumulating in workspace storage.

## Open questions

- Whether GitHub will later add a broader personal or organization memory layer that changes this comparison.
- How much live planning state in Copilot agents is persisted in practice versus only kept temporarily during a run.
- Which parts of local Copilot client storage are stable product concepts versus implementation details that may change over time.

## Recommended next move

Keep using the three-layer model in future docs and discussions:

1. **GitHub-hosted learned memory** → Copilot Memory
2. **client-local operational state** → VS Code/Copilot session storage
3. **repo-authored durable knowledge** → `ai-team` docs, instructions, logs, and task files

That vocabulary is accurate, teachable, and less likely to overclaim private implementation details.

## Sources

- [GitHub Docs — About agentic memory for GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)
- [GitHub Docs — Managing and curating Copilot Memory](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/copilot-memory)
- `analysis/copilot/copilot-memory-concept.md`
- `analysis/concepts/core/memory.md`
- `analysis/copilot/copilot-overview.md`
- `analysis/copilot/copilot-chat.md`
