# @ai-team/core

Pure TypeScript library for managing AI agent teams. This package contains all business logic and has ZERO UI dependencies.

## Design Principles

- **IDE-Agnostic**: No imports from vscode, react, electron, or any UI framework
- **File-Based**: All state stored in `.ai-team/` folder
- **Fully Testable**: Can be tested without any IDE or UI
- **Cross-Platform**: Works on Windows, macOS, Linux
- **Runtime Source of Truth**: Core runtime state comes from `.ai-team/*`, with each agent in a single `.agent.md` file (YAML frontmatter for all metadata, Markdown body for the portfolio)

## Architecture

```
src/
├── index.ts              # Public API exports
├── types/                # TypeScript interfaces and Zod schemas
├── agent/                # Agent management (CRUD)
├── skill/                # Skill (role) management
├── team/                 # Team graph and hierarchy
├── context/              # Context sharing and permissions
├── chat/                 # Chat orchestration
├── tools/                # Agent tool system
├── storage/              # File I/O and persistence
├── avatar/               # Avatar generation
└── watcher/              # File watching
```

## Usage

```typescript
import { TeamGraph, AgentManager } from '@ai-team/core';

// Load team from workspace
const team = await TeamGraph.load('/path/to/workspace');

// Get all agents
const agents = team.getAgents();

// Create new agent
const agent = await AgentManager.create('/path/to/workspace', {
  name: 'Sarah Chen',
  role: 'senior-frontend-developer',
  reportsTo: 'tech-lead',
});
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```
