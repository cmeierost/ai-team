# Copilot Instructions for AI Team Project

When writing code for this project, follow these guidelines:

## Architecture Rules

1. **Core Library Isolation**: NEVER import UI dependencies in `packages/core/`
   - ❌ NO: `vscode`, `react`, `react-dom`, `electron`
   - ✅ YES: `gray-matter`, `zod`, `chokidar`, Node.js built-ins

2. **Browser Compatibility**: NEVER import `@ai-team/core` in browser packages
   - ❌ NO: Import core in `packages/web/` - it uses Node.js fs/path APIs
   - ✅ YES: Use mock data or create a backend API server to expose core functionality
   - Package separation: CLI/VSCode use core directly, web needs API layer

3. **File-Based State**: Store all data as files in `.ai-team/` folder
   - Use JSON for structured data
   - Use Markdown with YAML frontmatter for agents/skills
   - Use JSONL for append-only logs (chat history)

4. **Manual Context Control**: Agents can ONLY access files in their `contextPaths`
   - Always check permissions before reading/writing files
   - Throw `PermissionError` if agent lacks access

## Code Style

1. **Naming Conventions**:
   - Files: `kebab-case.ts`
   - Classes: `PascalCase`
   - Functions: `camelCase`
   - Constants: `UPPER_SNAKE_CASE`
   - Types: `PascalCase`

2. **Async/Await**: Prefer `async`/`await` over promises
   ```typescript
   // Good
   async function loadAgent(path: string): Promise<Agent> {
     const content = await fs.readFile(path, 'utf-8');
     return parseAgent(content);
   }
   
   // Avoid
   function loadAgent(path: string): Promise<Agent> {
     return fs.readFile(path, 'utf-8').then(parseAgent);
   }
   ```

3. **Error Handling**: Use typed errors
   ```typescript
   export class PermissionError extends Error {
     constructor(agentId: string, filePath: string) {
       super(`Agent ${agentId} does not have permission to access ${filePath}`);
       this.name = 'PermissionError';
     }
   }
   ```

4. **Validation**: Use Zod schemas for all external data
   ```typescript
   import { z } from 'zod';
   
   const AgentSchema = z.object({
     name: z.string(),
     role: z.string(),
     reportsTo: z.string().optional(),
   });
   
   export type AgentConfig = z.infer<typeof AgentSchema>;
   ```

## File Formats

1. **agent.md**: YAML frontmatter + Markdown body
2. **skill.md**: YAML frontmatter + Markdown body
3. **Meeting summaries**: Markdown with metadata header
4. **Private chats**: JSONL (one message per line)

## Package-Specific Guidelines

### @ai-team/core

- Pure functions where possible
- Export types alongside implementations
- JSDoc comments for ALL public APIs
- No console.log (throw errors instead)
- Fully testable without UI

Example:
```typescript
/**
 * Load agent configuration from file
 * @param filePath - Absolute path to agent.md file
 * @returns Parsed agent data
 * @throws {FileNotFoundError} If file doesn't exist
 * @throws {ValidationError} If frontmatter is invalid
 */
export async function loadAgent(filePath: string): Promise<Agent> {
  const content = await fs.readFile(filePath, 'utf-8');
  const { data, content: markdown } = matter(content);
  return AgentSchema.parse({ ...data, markdown });
}
```

### @ai-team/cli

- Use `commander` for command structure
- Use `inquirer` for interactive prompts
- Use `chalk` for colors, `ora` for spinners
- Handle errors gracefully (user-friendly messages)

### @ai-team/web

- React functional components with hooks
- TypeScript for all components
- Props interfaces exported
- Use react-flow for graph visualization

### @ai-team/vscode

- Keep adapters thin (delegate to core library)
- Handle VS Code API lifecycle properly
- Dispose resources in deactivate()

## Patterns to Follow

1. **Tool System**: Implement `AgentTool` interface
   ```typescript
   export const readFileTool: AgentTool = {
     name: 'read_file',
     description: 'Read file contents',
     parameters: z.object({
       filePath: z.string(),
       startLine: z.number().optional(),
       endLine: z.number().optional(),
     }),
     execute: async (params, context) => {
       // Check permissions first
       if (!canAccess(context.agent, params.filePath)) {
         throw new PermissionError(context.agent.id, params.filePath);
       }
       // Implementation
     },
   };
   ```

2. **File Operations**: Always use absolute paths internally
   ```typescript
   // Good
   const absolutePath = path.resolve(workspaceRoot, relativePath);
   
   // Bad - fragile
   const content = await fs.readFile('../../some/file.ts');
   ```

3. **Agent Discovery**: Use glob patterns
   ```typescript
   import { glob } from 'glob';
   
   const agentFiles = await glob('**/{agent,skill}.md', {
     cwd: workspaceRoot,
     absolute: true,
   });
   ```

## Testing

1. Write tests alongside implementation
2. Use fixtures in `__fixtures__/` directories
3. Test core library without any UI
4. Mock file system where appropriate

## Documentation

1. JSDoc for public APIs (helps Copilot suggestions)
2. README.md in each package
3. Examples in comments

## Common Pitfalls to Avoid

- ❌ Importing VS Code in core package
- ❌ Storing state in memory (use files)
- ❌ Hardcoded file paths (always resolve from workspace root)
- ❌ Not checking agent permissions before file access
- ❌ Console.log in library code (use error throwing)
- ❌ Forgetting to close file watchers (memory leaks)

## Tool Reference

Agents should have access to these tools (implement as needed):

**Core Tools**:
- `semantic_search` - Search codebase semantically
- `file_search` - Find files by glob pattern
- `read_file` - Read file contents
- `write_file` - Modify files (permission-checked)
- `get_errors` - Get linter/compiler errors
- `get_git_status` - Check git status

**Agent Tools**:
- `delegate_to_agent` - Ask another agent for help
- `ask_human` - Request clarification from developer

**HR Tools** (restricted to HR Director):
- `create_agent` - Hire new team member
- `archive_agent` - Offboard agent
- `assess_performance` - Analyze activity

## When in Doubt

1. Check ARCHITECTURE.md for system design
2. Check types in `packages/core/src/types/`
3. Keep core library pure and testable
4. Prefer explicit over implicit
5. Throw descriptive errors

## Web Development & Testing

**CRITICAL**: Always test web applications live with Playwright before considering them complete.

1. **Live Testing Workflow**:
   ```bash
   # Start dev server in background
   cd packages/web && pnpm dev
   
   # Use Playwright to navigate and screenshot
   mcp_microsoft_pla_browser_navigate to http://localhost:3001
   mcp_microsoft_pla_browser_take_screenshot
   
   # Check browser console for errors
   # Look at the screenshot to verify UI renders correctly
   ```

2. **Browser Compatibility**:
   - Web packages CANNOT import `@ai-team/core` (uses Node.js APIs)
   - Use mock data for development
   - Create backend API server to expose core functionality
   - Test that page loads without console errors

3. **UI Development**:
   - Always verify with screenshots that UI actually renders
   - Check browser console for runtime errors
   - Test interactive elements (clicks, forms, etc.)
   - Ensure responsive design works at different viewport sizes

4. **Common Issues**:
   - Blank page = Check browser console for import errors
   - "Module externalized" warnings = Node.js API in browser context
   - TypeError on class extends = Missing polyfill or wrong environment

**Remember**: Code that compiles ≠ code that works in browser. Always test live!


---

Following these guidelines ensures consistent, maintainable code that Copilot can easily understand and extend.
