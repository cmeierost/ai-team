# VS Code Integration for AI and Copilot-Style Features

This document describes the key **VS Code APIs and concepts** needed to build Copilot-style features (diff previews, chat panels, inline suggestions) that ai-team or other AI backends can use. These features are **part of the editor**, not Copilot-specific, so any extension can use them.

---

## 1. Diff Views for AI Changes

VS Code provides a built-in diff viewer (same engine used for Git diffs). AI extensions use it to show “before vs after” changes.

### 1.1. `vscode.diff` Command

Any extension can open a diff view between two URIs:

```ts
import * as vscode from 'vscode';

// leftUri: original content, rightUri: modified content
await vscode.commands.executeCommand(
  'vscode.diff',
  leftUri,
  rightUri,
  'AI Change Preview'
);
```

- `leftUri` and `rightUri` can point to real files or to **virtual documents** (see below).
- The title (`'AI Change Preview'`) appears in the diff tab.

### 1.2. Virtual Documents (`TextDocumentContentProvider`)

To show diffs without writing to disk, extensions can expose virtual content:

```ts
class AiPreviewProvider implements vscode.TextDocumentContentProvider {
  onDidChange?: vscode.Event<vscode.Uri>;

  provideTextDocumentContent(uri: vscode.Uri): string {
    // Return the text for this virtual document (e.g., AI-generated code)
    return getAiGeneratedContentForUri(uri);
  }
}

vscode.workspace.registerTextDocumentContentProvider('ai-preview', new AiPreviewProvider());
```

- URIs like `ai-preview:before.json` and `ai-preview:after.json` can then be passed to `vscode.diff`.
- This is how you can preview AI patches **before** writing them to the workspace.

### 1.3. Typical AI Diff Flow

1. AI backend proposes a patch (e.g., unified diff or replacement text).
2. Extension builds two virtual documents:
   - Original content (snapshot before change).
   - Modified content (after applying patch in memory).
3. Extension opens a diff using `vscode.diff` so the user can inspect and accept/reject.

ai-team’s VS Code extension can use exactly this pattern for “AI-made changes” without relying on Copilot APIs.

---

## 2. Chat Panels and Webviews

Copilot Chat-like interfaces in VS Code are usually implemented with **webviews** and custom views.

### 2.1. Webview Panels

- The extension creates a `WebviewPanel` to host a custom HTML/JS UI (often React).
- The panel communicates with the extension host via `postMessage` / `onDidReceiveMessage`.

High-level pattern:

1. User opens an "AI Chat" view.
2. Webview renders a chat UI and sends user messages to the extension.
3. Extension forwards messages to the AI backend (e.g., ai-team core over Node APIs).
4. Extension streams responses back to the webview, which updates the chat.

Docs:
- VS Code Webview API: https://code.visualstudio.com/api/extension-guides/webview

### 2.2. Tree / Sidebar Views

- Extensions can create custom tree views or sidebars to show:
  - Conversation list.
  - Active tasks/agents.
  - Recent AI actions or diffs.

Docs:
- Views and tree view API: https://code.visualstudio.com/api/extension-guides/tree-view

---

## 3. Inline Suggestions and Code Actions

While ai-team itself is backend-agnostic, it’s useful to know the VS Code primitives for in-editor assistance.

### 3.1. Inline Completions

VS Code exposes an inline completions API:

- Extensions register an `InlineCompletionItemProvider`.
- The provider returns inline suggestions (ghost text) based on the current document and position.

Docs:
- Inline completions: https://code.visualstudio.com/api/language-extensions/inline-completions

ai-team can be used as the **engine** behind such suggestions (via `@ai-team/core`), with the VS Code extension acting as the provider.

### 3.2. Code Actions and Quick Fixes

- Code actions: lightbulb suggestions (e.g., "Fix with AI", "Refactor with AI").
- Extensions register `CodeActionProvider` to offer actions based on diagnostics or selection.

Pattern:
- User sees a diagnostic or selects code.
- Code action "Ask ai-team to refactor" appears.
- When chosen, extension calls ai-team, then either:
  - Applies edits directly, or
  - Shows a diff first using `vscode.diff`.

Docs:
- Code actions: https://code.visualstudio.com/api/language-extensions/programmatic-language-features#code-actions

---

## 4. Wiring ai-team into VS Code

In this repository, `packages/vscode` should:

- Stay thin and delegate logic to `@ai-team/core`.
- Use the APIs above to:
  - Show AI diffs for proposed edits (using `vscode.diff` and virtual docs).
  - Host an ai-team chat/webview panel.
  - Offer ai-team-powered inline completions and code actions.

Because all of these capabilities are **standard VS Code APIs**, they are not tied to Copilot and can be used freely by ai-team or any other extension.

---

## Further Reading

- VS Code Extension API overview: https://code.visualstudio.com/api
- Diff and file system functionality: https://code.visualstudio.com/api/extension-guides/virtual-documents
- Webviews: https://code.visualstudio.com/api/extension-guides/webview
- Language features (completions, code actions): https://code.visualstudio.com/api/language-extensions/overview
