# Copilot Memory: what it is, and what it is not

## Scope

This note explains GitHub Copilot Memory as an official concept, what GitHub documents about how it works, and how it differs from local VS Code chat/session storage. It does **not** claim to document GitHub's private internal implementation beyond what GitHub has published.

## Key points

- Copilot Memory is GitHub's **repository-scoped persistent memory** for Copilot, not just a temporary chat plan or local editor cache.
- Each memory is stored with **citations to code locations** and is only reused after GitHub validates those citations against the current codebase and branch.
- Local VS Code folders may contain chat sessions, edit sessions, resources, or indexes, but those are best understood as **client-side session artifacts**, not the official definition of Copilot Memory.

## What we know

GitHub describes Copilot Memory as a way for Copilot to build a persistent understanding of a repository over time. Memories are described as tightly scoped pieces of repository knowledge deduced by Copilot while it works. They are repository-specific, and they are only created in response to Copilot activity initiated by users who have Copilot Memory enabled.

GitHub also documents that memories are shared across Copilot surfaces within the same repository scope. A memory learned by Copilot coding agent can later help Copilot code review or Copilot CLI, as long as the memory is relevant and validates successfully.

The important storage behavior GitHub does document is:

- memories are stored with **citations** to specific code locations
- Copilot validates those citations against the **current codebase** and the **current branch** before using a memory
- a memory is only used if that validation succeeds
- memories are **automatically deleted after 28 days** to reduce staleness
- if a memory is validated and used again, GitHub may store a fresh memory with the same details, effectively extending its useful life

GitHub also makes the scope model fairly clear:

- memories are **repository-scoped**, not user-scoped
- memories for one repository are only used in that same repository
- memories are created only in response to actions in that repository by users with **write permission** and with Copilot Memory enabled
- repository owners can review and delete stored memories from the repository settings UI on GitHub

GitHub currently documents Copilot Memory as being used by:

- Copilot coding agent
- Copilot code review
- Copilot CLI

At the time of writing, GitHub also notes that the feature is in **public preview** and subject to change.

## What it is not

Copilot Memory should not be treated as a generic synonym for every form of Copilot state.

It is **not** the same thing as:

- the rolling context window of a single chat
- temporary step-by-step planning inside one agent run
- editor-side caches or indexes
- the raw transcript of a local chat session
- any one local file or folder inside VS Code

That distinction matters because public GitHub documentation is much clearer about **repository-level memory with validation and retention rules** than it is about universal local storage formats for live plans or chat state.

In other words: if the question is "what is Copilot's durable learned knowledge layer for a repository?" the answer is Copilot Memory. If the question is "where does the editor keep local session artifacts while I chat?" that is a separate client-side storage question.

## Example local VS Code storage links

These are **example** local paths that can help illustrate where VS Code may keep Copilot-related session artifacts. They are included as examples of local storage locations, not as the official definition of Copilot Memory, and exact paths can vary by environment.

- [chat sessions](file:///C:/Users/%3Cuser%3E/AppData/Roaming/Code/User/workspaceStorage/%3Cworkspace-storage-id%3E/chatSessions/)
- [chat editing sessions](file:///C:/Users/%3Cuser%3E/AppData/Roaming/Code/User/workspaceStorage/%3Cworkspace-storage-id%3E/chatEditingSessions/)
- [Copilot Chat session resources](file:///C:/Users/%3Cuser%3E/AppData/Roaming/Code/User/workspaceStorage/%3Cworkspace-storage-id%3E/GitHub.copilot-chat/chat-session-resources/)
- [Copilot Chat local index database](file:///C:/Users/%3Cuser%3E/AppData/Roaming/Code/User/workspaceStorage/%3Cworkspace-storage-id%3E/GitHub.copilot-chat/local-index.1.db)
- [Copilot Chat workspace chunks database](file:///C:/Users/%3Cuser%3E/AppData/Roaming/Code/User/workspaceStorage/%3Cworkspace-storage-id%3E/GitHub.copilot-chat/workspace-chunks.db)

These paths are useful as examples of local editor-side artifacts. They should not be confused with GitHub's documented repository-level memory model.

## What it means

For `ai-team`, the useful mental model is:

1. **Copilot Memory** is the durable, repository-scoped learning layer GitHub has publicly documented.
2. **Chat/session storage** is the local or product-specific machinery that may support an active conversation, edit flow, or context cache.
3. **Temporary plans** are best treated as ephemeral task state unless GitHub explicitly documents them as part of the durable memory model.

That means we should avoid describing Copilot as if it had one single universal "plan file" or one universal local persistence format across all clients. The stronger and more defensible claim is that GitHub now provides a repository-scoped memory system with validation, citations, reviewability, and automatic expiry.

This also means custom instructions and repository docs still matter. Copilot Memory reduces the need to repeat the same conventions manually, but it does not make explicit project guidance obsolete. Instead, it gives Copilot another way to retain repository-specific knowledge that it discovers through actual work.

## Open questions

- Whether GitHub will later expose broader personal or organization-scoped memory models beyond the current repository-focused behavior.
- How much of the live planning state used during agent execution is persisted in a durable way versus summarized, trimmed, or discarded.
- Whether future Copilot clients outside the currently documented surfaces will adopt the same memory model unchanged.

## Recommended next move

Use this note as the repository's short reference for Copilot Memory, and describe local VS Code storage separately as session or cache artifacts unless GitHub publishes stronger guarantees about their meaning.

If we want a follow-up note, the best next document would be a narrow comparison between:

- Copilot Memory
- local VS Code chat/session storage
- `.ai-team/` durable project memory and instruction files

That comparison would make the boundary between GitHub-hosted memory and repo-authored guidance even clearer.

## Sources

- [GitHub Docs — About agentic memory for GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/copilot-memory)
- [GitHub Docs — Managing and curating Copilot Memory](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/copilot-memory)
- `analysis/copilot/copilot-overview.md`
- `analysis/copilot/copilot-chat.md`
