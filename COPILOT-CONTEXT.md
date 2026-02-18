# AI Team Context Controller - Project Context for Copilot

## What We're Building

A VS Code extension and CLI tool that lets developers manage virtual AI "employees" organized like a real software company. Each AI agent is a specialized team member with:

- **Human identity**: Name (e.g., "Sarah Chen"), AI-generated avatar, personality
- **Role & expertise**: Senior Frontend Dev, QA Engineer, Tech Lead, etc.
- **Organizational position**: Reports to someone, owns features, has specializations
- **Controlled context**: Can only access files they're assigned to
- **Chat history**: Private conversations + committed meeting summaries
- **Tool capabilities**: Can search code, read files, delegate to other agents

## Key Innovation

**Top-Down Control**: Talk to CTO for strategy → automatically delegates to managers → tech leads → developers → code gets written. Or talk directly to specific junior dev for focused task.

**Lifecycle Management**: HR Director can hire new agents, archive inactive ones, assess performance.

**Meeting Summaries**: Casual chat is private (`.ai-team/private/chats/`), but important decisions become committed meeting summaries (`.ai-team/meetings/`) that other agents can reference.

## This Tool Mirrors GitHub Copilot (Feb 2026)

We're building what Copilot can do, but for a TEAM of agents:

| Copilot Tool | AI Team Equivalent |
|--------------|-------------------|
| `semantic_search` | Agents can search codebase |
| `read_file` | Agents can read files (permission-checked) |
| `get_errors` | Agents can see linter/compiler errors |
| `runSubagent` | Agents can delegate to other agents |
| `ask_questions` | Agents can ask human for clarification |

## Project Structure

```
ai-team/
├── packages/
│   ├── core/          # Pure TypeScript library (NO UI dependencies)
│   ├── cli/           # Command-line interface (wraps core)
│   ├── web/           # React dashboard (graph viz, chat UI)
│   └── vscode/        # VS Code extension (thin adapter)
├── ARCHITECTURE.md    # Complete system design (READ THIS!)
├── .github/
│   └── copilot-instructions.md  # Coding guidelines
└── docs/
    └── file-formats.md  # agent.md and skill.md schemas
```

## Core Principles for Development

1. **Library-First**: ALL business logic goes in `packages/core`. UI packages are thin wrappers.
2. **File-Based State**: Everything stored in `.ai-team/` folder (git-friendly JSON/Markdown)
3. **Manual Context**: Agents can only access files explicitly shared with them
4. **TypeScript**: Strongly typed, Zod schemas for validation
5. **Testable**: Core library has zero UI, fully testable without IDE

## Organizational Roles (Full Software Company)

**Executive Tier**:
- CTO (technical strategy, ADRs)
- HR Director (hire/fire agents, team structure)

**Leadership**:
- Engineering Manager (sprint planning, team coordination)
- QA Lead (test strategy, quality metrics)

**Team Leads**:
- Tech Lead (detailed design, code review)
- Senior Architect (architecture compliance)

**Individual Contributors**:
- Senior/Mid/Junior Developers (implementation)
- QA Engineers (test implementation, spec verification)

**Quality Gates**:
- Code Reviewers (approve PRs, standards enforcement)
- Security Reviewer (security review)

**Cross-Concern**:
- Technical Consultants (React expert, DB expert, etc.)

## File Formats

### agent.md (Team Member)
```yaml
---
name: Sarah Chen
role: senior-frontend-developer  # References skill.md
type: individual-contributor
contextLevel: module

reportsTo: tech-lead
features: [login, dashboard]
specializations: [react, typescript]

avatar:
  seed: sarah-chen-frontend-2026
  type: ai-generated

pronouns: she/her
timezone: PST
---

# Sarah Chen - Portfolio
...
```

### skill.md (Role Template)
```yaml
---
name: senior-frontend-developer
type: individual-contributor
tools: [semantic_search, read_file, write_file, delegate_to_agent]
contextLevel: module
---

# Role Description
...
```

## Development Workflow with Copilot

### Phase 1: Types & Schemas (Week 1)
- Define all TypeScript interfaces in `packages/core/src/types/`
- Create Zod schemas for validation
- Copilot will autocomplete based on these types

### Phase 2: Core Library (Week 2-3)
- Write function signatures with JSDoc
- Let Copilot implement the logic
- Use `/tests` to generate test suites
- Use `runSubagent` for complex research

### Phase 3: CLI (Week 4)
- Commander.js command structure
- Copilot excellent at CLI generation
- Colorful terminal output with chalk/ora

### Phase 4: Web UI (Week 5)
- React + Vite + react-flow
- Copilot generates components from descriptions
- Graph visualization for team hierarchy

### Phase 5: VS Code Extension (Week 6)
- TreeView, Webview, Chat Participant
- Adapters bridge VS Code APIs to core library

## Example Usage (Once Built)

```bash
# Initialize workspace
ai-team init

# HR Director creates agents
ai-team hr hire "Sarah Chen" --role=senior-frontend-dev
ai-team hr hire "John Smith" --role=backend-lead

# View team
ai-team list  # Tree view in terminal

# Talk to specific agent
ai-team chat sarah
> Sarah: Hi! I can help with React, TypeScript, or accessibility questions.
> You: Can you review my Login component?
> Sarah: [analyzes code, provides feedback]
> [Save as Meeting Summary] → .ai-team/meetings/sarah/2026-02-18-login-review.md

# Share context with agent
ai-team context share tech-lead sarah --files="src/auth/**"

# Assess team performance
ai-team hr assess --period=30days

# Open web dashboard
ai-team serve  # Launches at localhost:3000
```

## In VS Code

- **Sidebar**: Tree view of all agents (click to chat)
- **Graph View**: Interactive team hierarchy (react-flow)
- **Chat**: Click agent → chat opens with @agent:sarah
- **Profile View**: See agent portfolio, meeting history, activity
- **HR Panel**: Hire, archive, assess agents (HR Director role)

## Tech Stack

- **Language**: TypeScript
- **Monorepo**: pnpm workspaces
- **Validation**: Zod
- **CLI**: commander, inquirer, chalk, ora
- **Web**: React, Vite, react-flow
- **File Parsing**: gray-matter (YAML frontmatter)
- **File Watching**: chokidar (cross-platform)
- **LLM**: OpenAI SDK / Anthropic Claude
- **Avatar Generation**: AI image API or deterministic avatars

## How to Use Copilot Effectively

1. **Open these files in tabs** (Copilot reads them):
   - ARCHITECTURE.md (system design)
   - packages/core/src/types/index.ts (type definitions)
   - Current file you're working on

2. **Write specs before code**:
   - Create `DESIGN.md` in each package
   - Write JSDoc comments on function signatures
   - Copilot implements based on specs

3. **Use Copilot Chat**:
   - `@workspace` - Search all files for context
   - `/tests` - Generate tests for selected code
   - `/fix` - Debug and improve code
   - `/doc` - Add documentation
   - `runSubagent` - Research complex topics

4. **Test-Driven AI**:
   - Write test skeleton first
   - Copilot suggests implementation that passes tests

5. **Iterative Enhancement**:
   - Accept basic implementation (Tab)
   - Use Chat to add validation, error handling, tests
   - Better than trying to get perfect code first time

## What Makes This Project Unique

This isn't just another AI coding assistant - it's a **simulation of an entire software organization** where:

- You can delegate high-level goals to CTO and watch work cascade down
- Junior devs need guidance, seniors are autonomous
- Consultants provide domain expertise across teams
- HR Director manages team composition
- Meeting summaries create institutional knowledge
- Context control prevents information leaks

It's like having a full engineering team, but controllable at any altitude.

## Success Metrics

- **70-80% code written by Copilot** (human provides architecture and reviews)
- **Complete organizational hierarchy** (exec → junior dev)
- **Natural interactions** (human names, avatars, personalities)
- **Clean git history** (private chats excluded, meeting summaries committed)
- **Extensible** (core library works with any IDE or CLI)

---

**Now that Copilot understands the project, let's build it! 🚀**
