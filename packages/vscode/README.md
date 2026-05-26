# AI Team VS Code Extension

VS Code adapter for AI Team runtime integration. The extension surfaces connections, pending changes, and editor-native review actions while keeping business logic in shared packages.

## Features

- **Connections view** for active workspace/server status
- **Pending changes view** for code-edit proposals
- **Keep/Undo actions** for proposals and individual files
- **Open Web App** shortcut for the browser UI

## Commands

- `AI Team: Initialize AI Team Workspace`
- `AI Team: Open Web App`
- `AI Team: Keep All`
- `AI Team: Undo All`
- `AI Team: Show Diff`
- `AI Team: Show Pending Changes`

## Usage

1. Open a workspace in VS Code.
2. Run **AI Team: Initialize AI Team Workspace** if `.ai-team/` is missing.
3. Open the **AI Team** activity bar to see Connections and Pending Changes.
4. Use **Keep All** / **Undo All** to manage proposed edits.

## Architecture

This extension is a thin IDE adapter. It translates shared proposal and connection events into VS Code-native UI and commands.
