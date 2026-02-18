# AI Team Context Controller - Architecture

## System Overview

A VS Code extension and CLI tool for managing virtual AI development teams. Enables developers to interact with AI "employees" organized in a realistic software company structure, with full context control and lifecycle management.

## Core Philosophy

1. **Library-First**: `@ai-team/core` contains ALL business logic with ZERO UI dependencies
2. **CLI-Primary**: Complete functionality available via command line
3. **File-Based State**: All configuration stored in `.ai-team/` folder (git-friendly)
4. **Manual Context Control**: Explicit sharing, no automatic inheritance
5. **Realistic Organization**: Full software company simulation (exec → junior dev)

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│  UI Layer (Adapters)                                    │
│  ├─ VS Code Extension (thin wrapper)                    │
│  ├─ Web Dashboard (React + Vite)                        │
│  └─ CLI (commander.js wrapper)                          │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│  @ai-team/core (Pure TypeScript Library)                │
│  ├─ TeamGraph (hierarchy management)                    │
│  ├─ AgentManager (CRUD operations)                      │
│  ├─ ContextManager (manual sharing)                     │
│  ├─ ChatOrchestrator (LLM integration)                  │
│  ├─ ToolSystem (agent capabilities)                     │
│  └─ FileWatcher (real-time sync)                        │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│  Storage Layer                                           │
│  ├─ .ai-team/agents/*.md (committed)                    │
│  ├─ .ai-team/roles/*.skill.md (committed)               │
│  ├─ .ai-team/meetings/ (committed summaries)            │
│  ├─ .ai-team/avatars/*.png (committed)                  │
│  └─ .ai-team/private/chats/ (NOT committed)             │
└──────────────────────────────────────────────────────────┘
```

## Package Responsibilities

### @ai-team/core

**Pure TypeScript library. NO imports from:**
- `vscode` (VS Code APIs)
- `react` / `react-dom` (UI frameworks)
- `electron` (desktop APIs)

**Allowed dependencies:**
- `gray-matter` (YAML frontmatter parsing)
- `zod` (schema validation)
- `chokidar` (cross-platform file watching)
- `openai` / `anthropic` (LLM SDKs)

**Exports:**
- All domain models (Agent, Skill, Feature, etc.)
- All business logic classes
- All tool definitions
- File format parsers

### @ai-team/cli

**Wraps core library with CLI interface.**

Dependencies: `@ai-team/core`, `commander`, `inquirer`, `chalk`, `ora`

Commands:
- `ai-team init` - Initialize workspace
- `ai-team create <name>` - Create agent
- `ai-team list` - Show team hierarchy
- `ai-team chat <agent>` - Interactive chat
- `ai-team context share/list/revoke` - Context management
- `ai-team hr hire/archive/assess` - HR operations
- `ai-team serve` - Launch web dashboard

### @ai-team/web

**React dashboard for graph visualization and management.**

Dependencies: `@ai-team/core`, `react`, `react-flow`, `vite`

Features:
- Interactive team graph (react-flow)
- Agent profile editor
- Chat interface
- Context management UI
- Meeting summary viewer

### @ai-team/vscode

**Thin VS Code extension adapter.**

Dependencies: `@ai-team/core`, `vscode` (external)

Adapters:
- TreeView → TeamGraph
- Webview → Embeds @ai-team/web
- Chat Participant → ChatOrchestrator
- Commands → Core library methods

## Data Models

### Agent (Virtual Employee)

```typescript
interface Agent {
  id: string;                    // Unique identifier
  name: string;                  // Human name (e.g., "Sarah Chen")
  role: string;                  // References skill.md
  type: RoleType;                // hierarchical, feature-owner, consultant, etc.
  
  // Organization
  reportsTo?: string;            // Manager's agent ID
  features: string[];            // Feature assignments
  specializations: string[];     // Expertise areas
  
  // Context
  contextLevel: ContextLevel;    // task, module, feature, repository, organization
  contextPaths: string[];        // File patterns agent can access
  
  // Metadata
  avatar: AvatarConfig;
  personality: PersonalityConfig;
  pronouns: string;
  timezone: string;
  workHours: string;
  
  // File paths
  filePath: string;              // Path to agent.md
  skillPath: string;             // Path to skill.md
}
```

### Skill (Role Template)

```typescript
interface Skill {
  name: string;
  type: RoleType;
  description: string;
  responsibilities: string[];
  tools: string[];               // Tool names agent can use
  permissions: PermissionConfig;
  contextLevel: ContextLevel;
  filePath: string;
}
```

### Tool (Agent Capability)

```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute(params: unknown, context: ToolContext): Promise<unknown>;
}
```

## Organizational Structure

### Role Types

1. **Executive** (CTO, HR Director) - Strategic decisions, ADRs
2. **Leadership** (Engineering Manager, QA Lead) - Team coordination, planning
3. **Team Lead** (Tech Lead, Senior Architect) - Technical design, mentoring
4. **Individual Contributor** (Senior/Mid/Junior Dev) - Implementation
5. **Quality Gate** (Code Reviewer, QA Engineer) - Verification, standards
6. **Cross-Concern** (Consultants) - Domain expertise, available to all
7. **Product** (Product Owner, PM) - Requirements, acceptance criteria

### Context Levels

- **Organization**: Executives see strategic docs only (ADRs, roadmap)
- **Repository**: Architects, QA Lead see entire codebase (read-only)
- **Feature**: Team leads, POs see feature area code
- **Module**: Senior devs see specific modules
- **Task**: Junior devs see only assigned files

### Delegation Patterns

- **Downward** (Command): Exec → Manager → Lead → Dev
- **Upward** (Escalation): Dev → Lead → Manager (questions, blockers)
- **Peer** (Consultation): Any dev → Consultant (expertise)
- **Lateral** (Collaboration): Feature team members (coordination)

## File Formats

### agent.md (Team Member Instance)

```yaml
---
name: Sarah Chen
role: senior-frontend-developer
type: individual-contributor
contextLevel: module

# Organization
reportsTo: tech-lead
features: [login, dashboard]
specializations: [react, typescript, accessibility]

# Identity
avatar:
  type: ai-generated
  seed: sarah-chen-frontend-2026
pronouns: she/her
timezone: PST
workHours: 9am-5pm

# Access
permissions:
  read: [src/frontend/**, shared/types/**]
  write: [src/frontend/components/**, tests/frontend/**]
---

# Sarah Chen - Senior Frontend Developer

Expertise: React, TypeScript, Accessibility
Current Focus: OAuth implementation, Dashboard refactoring

## Recent Work
- Implemented token refresh UI (PR-156)
- Refactored Dashboard state management (PR-142)

## Meeting Summaries
See [meetings/sarah-chen/](../../meetings/sarah-chen/)
```

### skill.md (Role Template)

```yaml
---
name: senior-frontend-developer
type: individual-contributor
description: Senior developer specializing in frontend
contextLevel: module

responsibilities:
  - feature-implementation
  - code-review
  - mentoring

tools:
  - semantic_search
  - file_search
  - read_file
  - write_file
  - run_test
  - delegate_to_agent

permissions:
  read: [src/frontend/**, docs/**]
  write: [src/frontend/**, tests/**]
---

# Senior Frontend Developer Role

Implements features, reviews code, mentors junior developers.
Expertise in modern frontend frameworks and best practices.
```

## Tool System

Agents execute tasks using tools (modeled after GitHub Copilot Feb 2026):

**Core Tools:**
- `semantic_search` - Find relevant code semantically
- `file_search` - Glob pattern file discovery
- `read_file` - Read file contents with line ranges
- `write_file` - Modify files (with permission check)
- `get_errors` - Read compiler/linter errors
- `get_git_status` - Check git changes
- `run_test` - Execute tests

**Agent Interaction Tools:**
- `delegate_to_agent` - Ask another agent for help (like Copilot's runSubagent)
- `ask_human` - Request clarification (like Copilot's ask_questions)

**HR Tools** (HR Director only):
- `create_agent` - Hire new team member
- `archive_agent` - Offboard agent
- `reassign_agent` - Change reporting structure
- `assess_performance` - Analyze activity

## Chat & Meeting System

### Private Chat (Ephemeral)
- Stored in `.ai-team/private/chats/{agent-id}/YYYY-MM-DD.jsonl`
- NOT committed to git
- Natural conversation history
- Full context for agent

### Meeting Summaries (Permanent)
- Stored in `.ai-team/meetings/{agent-id}/YYYY-MM-DD-title.md`
- Committed to git
- AI-generated from chat sessions
- Contains: decisions, action items, related files
- Becomes part of agent's knowledge base

## UX Design

### Human-Like Agent Interactions

1. **Visual Identity**: AI-generated professional headshots
2. **Human Names**: "Sarah Chen" not "frontend-agent-1"
3. **Personality**: Communication style affects chat tone
4. **Presence**: Status indicators (available/busy/offline)
5. **Timezone Awareness**: Work hours per agent

### Smooth Workflows

- Click agent in graph → Opens chat immediately
- Important conversations → "Save as Meeting Summary" button
- AI auto-generates summary with decisions and action items
- Summaries become searchable project knowledge

## Technical Constraints

### Core Library Rules

1. **NO UI DEPENDENCIES**: Core library must run headless
2. **Cross-Platform**: Works on Windows, macOS, Linux
3. **File-Based**: No database, all data in files
4. **Git-Friendly**: Text formats, structured diffs
5. **Testable**: All logic testable without IDE

### Performance

- File watching debounced (500ms)
- Large graphs use virtual scrolling
- Streaming LLM responses
- Avatar generation cached

## Development Workflow

### For Copilot to Generate Code

1. **Write specs first** (this file, DESIGN.md per package)
2. **Define types early** (TypeScript interfaces with JSDoc)
3. **Write tests first** (Test-Driven AI)
4. **Let Copilot implement** (Tab through suggestions)
5. **Use runSubagent** for research and complex logic
6. **Iterate with /fix, /tests, /doc**

### Naming Conventions

- **Files**: kebab-case (`team-graph.ts`)
- **Classes**: PascalCase (`TeamGraph`)
- **Functions**: camelCase (`getAgentHierarchy`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_CONFIG_PATH`)
- **Types**: PascalCase (`Agent`, `Skill`)

### Error Handling

- Use typed errors (extend `Error`)
- Include context in error messages
- Validate with Zod schemas
- Handle file I/O errors gracefully

## Security & Permissions

- Agents can only read files in their `contextPaths`
- Write permissions checked before file modifications
- HR tools restricted to HR Director role
- Private chat data never exposed to other agents
- Meeting summaries reviewed before commit

## Extensibility

### Adding New Roles

1. Create `.ai-team/roles/{role-name}.skill.md`
2. Define tools and permissions
3. HR Director can hire agents with this role

### Adding New Tools

1. Implement `AgentTool` interface in core
2. Add to appropriate skill.md `tools` array
3. Tool automatically available to agents with that skill

### Custom IDE Integration

Other IDEs can:
1. Import `@ai-team/core` as library
2. Implement thin adapter layer
3. Reuse web dashboard (embed webview)
4. Call same CLI commands under the hood

---

**This architecture enables a realistic, controllable, extensible AI team simulation with maximum code reuse across CLI, web, and IDE interfaces.**
