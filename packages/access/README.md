# @ai-team/access

File-path access rights library — a layered policy engine for shell commands, tool calls, and direct path checks.

## Design Principles

- **Context-Based**: Access rights are organized into named contexts (one per agent, plus an optional global context)
- **Deny-Before-Allow**: Paths are denied by default; explicit allow rules grant access
- **Structured Verdicts**: Every check returns which paths were allowed/denied, why, and who else could do the work
- **Operation-Aware**: Understands shell commands and tool calls, not just raw paths
- **Delegation-Ready**: Built-in APIs for finding alternative contexts, ranking contexts by capability, and generating work assignments

## Architecture

```
src/
├── index.ts          # Public API exports
├── engine.ts         # AccessEngine — main entry point
├── types.ts          # Core types (AccessContext, AccessVerdict, etc.)
├── rights.ts         # Right, Effect, AccessRule definitions
├── registry.ts       # ContextRegistry — manage named contexts
├── policy.ts         # CompiledRuleSet — glob-based rule evaluation
├── operations.ts     # CommandRegistry, ToolRegistry, path extraction
├── paths.ts          # Path normalization and resolution utilities
└── __tests__/        # Test suite (66 tests)
```

## Usage

### Direct path checks

```typescript
import { AccessEngine } from '@ai-team/access';

const engine = new AccessEngine({ workspaceRoot: '/workspace' });

engine.registerContext({
  id: 'agent-a',
  label: 'Agent A',
  rules: [
    { right: 'read', effect: 'allow', pathPattern: 'src/**' },
    { right: 'write', effect: 'allow', pathPattern: 'src/my-module/**' },
  ],
});

const verdict = engine.checkPath('src/foo.ts', 'read', '/workspace', 'agent-a');
// verdict.allowed === true
```

### Shell command checks

```typescript
engine.commands.register({
  name: 'cat',
  args: [{ kind: 'rest', right: 'read' }],
});

const verdict = engine.checkCommand('cat src/foo.ts', '/workspace', 'agent-a');
// verdict.allowed === true, verdict.paths[0].right === 'read'
```

### Tool call checks

```typescript
engine.tools.register({
  name: 'read_file',
  pathParams: [{ paramName: 'filePath', right: 'read' }],
});

const verdict = engine.checkToolCall(
  'read_file',
  { filePath: 'src/foo.ts' },
  '/workspace',
  'agent-a',
);
// verdict.allowed === true
```

### Delegation and alternatives

When access is denied, the verdict includes which other contexts could handle the request:

```typescript
engine.registerContext({
  id: 'agent-b',
  label: 'Agent B',
  rules: [{ right: 'write', effect: 'allow', pathPattern: 'docs/**' }],
});

const verdict = engine.checkPath('docs/readme.md', 'write', '/workspace', 'agent-a');
// verdict.allowed === false
// verdict.alternativeContexts === [{ contextId: 'agent-b', label: 'Agent B' }]
```

### Introspection

```typescript
// Rank all contexts by how many rights they grant for a path
engine.rankContextsForPath('src/foo.ts', '/workspace');

// Identify gaps — what paths/rights a context is missing
engine.gapAnalysis('agent-a', ['src/foo.ts', 'docs/bar.md'], 'write', '/workspace');

// Generate work assignments — split paths across contexts
engine.assignWork(['src/a.ts', 'docs/b.md'], 'write', '/workspace');
```

## Integration with @ai-team/core

The adapter in `@ai-team/core` bridges AI Team agent types to this library:

```typescript
import { createAccessEngine } from '@ai-team/core';

const engine = createAccessEngine({
  workspaceRoot: '/workspace',
  fileTreeConfig,   // global read/write/create/delete paths
  agents,           // array of Agent objects
});

// ContextManager and ToolManager accept an optional engine:
const cm = new ContextManager(workspaceRoot, globalPerms, engine);
cm.canRead(agent, '/workspace/src/foo.ts');       // delegates to engine
cm.checkPathDetailed(agent, path, 'write');       // returns full AccessVerdict
```

## Development

```bash
pnpm --filter @ai-team/access build
pnpm --filter @ai-team/access exec vitest run
```
