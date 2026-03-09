# Hiring Brief — Backend Team Expansion Under Alex Morgan

Prepared by `john-smith` for `emily-davis`.

## Recommendation

Do **not** hire seven micro-specialists under Alex Morgan yet.

Instead, reshape Alex into the true backend lead and hire **four** focused backend agents under him. Keep the seven backend capability lanes as specialization boundaries and supporting skills, but group the work into four cleaner day-to-day ownership seats.

## Backend lead

- **Name:** Alex Morgan
- **Role:** Backend Lead
- **Reports to:** `sarah-lee`

### Why Alex should be the boss of backend

Alex already sits closest to `packages/core` and `packages/service`. He is the strongest existing owner for backend delivery, shared TypeScript discipline, and cross-package implementation changes. The repo needs him to stop acting like a lone senior engineer and start acting like the coordinator of backend execution.

## Recommended hires under Alex

### 1. Leah Brooks

- **Role:** Backend Runtime Engineer
- **Reports to:** `alex-morgan`

### Leah owns

- agent runtime behavior
- handoff and chat flow behavior
- workflow continuity
- service orchestration paths

### Why Leah exists

This gives Alex a focused owner for runtime behavior and orchestration flow instead of leaving those issues split awkwardly between core and service changes with no clear operator.

### 2. Ethan Carter

- **Role:** Backend Platform Engineer
- **Reports to:** `alex-morgan`

### Ethan owns

- file-system abstraction
- path permissions
- gitignore-aware workspace behavior
- tool execution boundaries and backend tooling safety

### Why Ethan exists

This gives the backend a clear owner for workspace safety and backend platform mechanics, which are too important to leave as side work under general implementation.

### 3. Maya Patel

- **Role:** Backend Data Engineer
- **Reports to:** `alex-morgan`

### Maya owns

- session and message storage
- SQLite-backed persistence
- storage contracts and migrations
- durable workflow, note, and task state behavior

### Why Maya exists

Persistence has distinct failure modes and deserves a dedicated owner instead of becoming a shared afterthought across runtime and orchestration work.

### 4. Victor Alvarez

- **Role:** Backend Intelligence Engineer
- **Reports to:** `alex-morgan`

### Victor owns

- LLM provider integration
- model behavior and connection paths
- code intelligence
- structured editing systems

### Why Victor exists

This gives the backend a real owner for provider behavior and code-aware backend intelligence without forcing Alex to personally carry every smart-system concern.

## Capability map behind this team shape

The backend capability lanes are still real:

1. agent runtime behavior
2. file system abstraction
3. session and message storage
4. LLM provider integration
5. tooling and permission model
6. service orchestration runtime
7. code intelligence and editing

But they should support a **four-person backend team**, not become seven tiny day-to-day reporting lines immediately.

## Supporting assets prepared

### Skills

- `.ai-team/skills/agent-runtime-behavior/SKILL.md`
- `.ai-team/skills/workspace-file-system-abstraction/SKILL.md`
- `.ai-team/skills/session-and-message-storage/SKILL.md`
- `.ai-team/skills/llm-provider-integration/SKILL.md`
- `.ai-team/skills/tooling-and-permission-model/SKILL.md`
- `.ai-team/skills/service-orchestration-runtime/SKILL.md`
- `.ai-team/skills/code-intelligence-and-editing/SKILL.md`

### Agents

- `.ai-team/agents/alex-morgan.agent.md`
- `.ai-team/agents/alex-morgan.agent.yml`
- `.ai-team/agents/leah-brooks.agent.md`
- `.ai-team/agents/leah-brooks.agent.yml`
- `.ai-team/agents/ethan-carter.agent.md`
- `.ai-team/agents/ethan-carter.agent.yml`
- `.ai-team/agents/maya-patel.agent.md`
- `.ai-team/agents/maya-patel.agent.yml`
- `.ai-team/agents/victor-alvarez.agent.md`
- `.ai-team/agents/victor-alvarez.agent.yml`

## Risks to watch

- Alex remains overloaded because people still route every backend issue to him instead of using the new team structure
- runtime and intelligence work blur together when ownership should stay explicit
- Ethan becomes a generic infrastructure sink instead of staying focused on backend platform safety
- Maya gets pulled into orchestration work that should remain with Leah unless persistence is the real issue
- Victor becomes the default owner for all LLM topics across the whole repo instead of staying focused on backend intelligence surfaces

## Onboarding note for Emily

Shape this as a **backend team under Alex**, not as four isolated specialists with decorative titles.

That means:

- make Alex the clear backend lead
- keep Sarah as the architectural authority above him
- keep the four hires narrow and complementary
- use the seven backend skills as specialization boundaries and supporting assets
- reinforce that backend work should route to the narrowest owner first, not bounce back to Alex by default

## Final recommendation

Emily should hire **four backend specialists under Alex Morgan**, not seven. The backend needs stronger ownership depth, but not so much slicing that Alex becomes a routing manager for a too-fragmented org.
