# AI Team VS Code Extension

VS Code extension for managing virtual AI development teams.

## Features

- **Team Sidebar**: View all team members in a hierarchical tree
- **Features View**: See agents grouped by feature assignments  
- **Graph Visualization**: Interactive team structure diagram
- **Agent Management**: Create, edit, and chat with agents
- **File Watching**: Auto-refresh when agents are modified

## Commands

- `AI Team: Show Team Graph` - Open interactive graph visualization
- `AI Team: List Team Members` - Quick pick list of all agents
- `AI Team: Create New Agent` - Interactive agent creation wizard
- `AI Team: Chat with Agent` - Start a conversation with an agent
- `AI Team: Initialize AI Team` - Set up .ai-team directory

## Usage

1. Open a workspace in VS Code
2. Run `AI Team: Initialize AI Team` command
3. View team members in the AI Team sidebar
4. Click on agents to open their configuration files
5. Use `Show Team Graph` for visual organization overview

## Architecture

This extension is a thin adapter around `@ai-team/core`, keeping all business logic IDE-agnostic.
