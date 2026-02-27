# Code Editing Tools - LLM Guidance

This document provides guidance for LLMs on how to effectively use code editing tools available in the AI Team system.

## Available Tools

### 1. Code Analysis Tools

#### `grep_code`
**Purpose:** Fast text-based search across files
**When to use:**
- Finding specific text patterns, function names, or variable references
- Quick searches that don't require AST understanding
- Case-insensitive searching with regex support

**Example:**
```javascript
grep_code({
  pattern: "TODO|FIXME",
  files: ["src/**/*.ts"],
  options: { caseInsensitive: true }
})
```

#### `analyze_complexity`
**Purpose:** Analyze TypeScript/JavaScript code complexity
**When to use:**
- Identifying complex functions that need refactoring
- Understanding code metrics before making changes
- Finding unused imports or overly nested code

**Example:**
```javascript
analyze_complexity({
  filePath: "src/utils/complex-logic.ts"
})
```

#### `find_symbol` (requires tree-sitter initialization)
**Purpose:** Locate symbol definitions using AST parsing
**When to use:**
- Finding where functions, classes, or types are defined
- Understanding code structure before making changes

#### `find_references` (requires tree-sitter initialization)
**Purpose:** Find all usages of a symbol
**When to use:**
- Understanding impact before renaming or changing APIs
- Finding all call sites of a function

#### `find_pattern` (requires tree-sitter initialization)
**Purpose:** Detect anti-patterns or code patterns
**When to use:**
- Finding console.log statements before production
- Detecting async functions without await
- Finding empty catch blocks

### 2. Code Edit Tool

#### `apply_code_edit`
**Purpose:** Propose changes to code files with permission validation
**Returns:** Proposal ID that users can review and approve

**Important Rules:**
1. **Always check permissions first** - The tool validates you have write access
2. **Provide clear descriptions** - Explain WHY the change is needed
3. **Break down large changes** - Multiple small proposals are better than one huge proposal
4. **Include context** - Describe what problem the change solves

**Example:**
```javascript
apply_code_edit({
  description: "Fix typo in error message and add proper error handling",
  changes: [
    {
      filePath: "src/handlers/auth.ts",
      oldContent: `throw new Error("Authentification failed");`,
      newContent: `throw new AuthenticationError("Authentication failed", { 
        user: userId, 
        timestamp: Date.now() 
      });`
    }
  ]
})
```

## Workflow Best Practices

### 1. Search Before Edit
Always analyze code before proposing changes:

```
1. Use grep_code to find relevant files
2. Use analyze_complexity to understand current state
3. Read the files you plan to modify
4. Propose changes with apply_code_edit
```

### 2. Respect Permissions
Code edit proposals automatically:
- Validate you have write access to files
- Check against your assigned glob patterns
- Provide guidance if access is denied

**Example Permission Error:**
```
"Cannot edit src/backend/api.ts - you only have access to src/frontend/**/*"
→ Suggestion: Assign this task to an agent with backend permissions
```

### 3. Break Down Changes
**DON'T:**
```javascript
apply_code_edit({
  description: "Refactor entire application",
  changes: [
    { filePath: "file1.ts", ... },
    { filePath: "file2.ts", ... },
    // ... 20 more files
  ]
})
```

**DO:**
```javascript
// Proposal 1
apply_code_edit({
  description: "Extract authentication logic to separate module",
  changes: [
    { filePath: "src/auth/authenticator.ts", ... }
  ]
})

// Proposal 2
apply_code_edit({
  description: "Update auth imports in main app",
  changes: [
    { filePath: "src/app.ts", ... }
  ]
})
```

### 4. Provide Clear Descriptions

**Bad:**
```
"Fix code"
"Update file"
"Changes as discussed"
```

**Good:**
```
"Fix off-by-one error in pagination logic that causes last item to be skipped"
"Update deprecated API call from getUserById to getUserByIdAsync"
"Add input validation to prevent SQL injection in search endpoint"
```

### 5. Handle Large Files Carefully

**Constraints:**
- Maximum 10 files per proposal (configurable)
- Maximum 500 lines of diff per file (warning threshold)
- Large deletions (>100 lines) trigger warnings

**Strategy:**
- For large refactors, create multiple proposals
- Focus each proposal on a single concern
- Wait for approval before proposing dependent changes

## Error Handling

### Permission Denied
```
Error: "Agent 'frontend-dev' cannot write to src/backend/api.ts"
```
**Response:**
- Acknowledge the permission boundary
- Suggest which agent should handle the task
- Or propose changes only to files you can access

### File Not Found
```
Error: "File src/utils/helpers.ts not found"
```
**Response:**
- Use grep_code to find the correct path
- Ask the user for clarification
- Check if file was renamed or moved

### Validation Errors
```
Error: "Proposal exceeds maximum file limit (15 > 10)"
```
**Response:**
- Split the proposal into smaller chunks
- Prioritize the most critical changes
- Create a sequence of related proposals

## Examples

### Example 1: Bug Fix
```javascript
// 1. Find the bug
grep_code({ 
  pattern: "calculateTotal", 
  files: ["src/**/*.ts"] 
})

// 2. Analyze the function
analyze_complexity({ 
  filePath: "src/utils/calculations.ts" 
})

// 3. Read the file to understand context
read_file({ filePath: "src/utils/calculations.ts" })

// 4. Propose the fix
apply_code_edit({
  description: "Fix calculateTotal rounding error - was using Math.floor instead of Math.round",
  changes: [{
    filePath: "src/utils/calculations.ts",
    oldContent: `function calculateTotal(items) {
  return Math.floor(items.reduce((sum, item) => sum + item.price, 0));
}`,
    newContent: `function calculateTotal(items) {
  return Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100;
}`
  }]
})
```

### Example 2: Refactoring with Multiple Files
```javascript
// Proposal 1: Create new utility
apply_code_edit({
  description: "Extract date formatting logic to reusable utility module",
  changes: [{
    filePath: "src/utils/date-formatter.ts",
    oldContent: "",
    newContent: `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function formatDateTime(date: Date): string {
  return date.toISOString();
}`
  }]
})

// Proposal 2: Update imports (after Proposal 1 is approved)
apply_code_edit({
  description: "Update components to use new date formatter utility",
  changes: [
    {
      filePath: "src/components/DataDisplay.tsx",
      oldContent: `const formattedDate = date.toISOString().split('T')[0];`,
      newContent: `import { formatDate } from '../utils/date-formatter';
const formattedDate = formatDate(date);`
    }
  ]
})
```

## Summary

1. **Search first, edit second** - Use analysis tools before proposing changes
2. **Respect permissions** - Only edit files you have access to
3. **Small, focused proposals** - Break down large changes
4. **Clear descriptions** - Explain the "why" not just the "what"
5. **Error handling** - Handle permission errors gracefully
6. **Sequential changes** - For dependent changes, wait for approval between proposals

## Additional Resources

- Permission system: See `.ai-team/agents/*.md` for your glob patterns
- Proposal status: Use VS Code extension or `ait code-edit` command
- Code analysis: Combine grep_code with analyze_complexity for thorough understanding
