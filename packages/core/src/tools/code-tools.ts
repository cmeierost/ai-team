import path from 'node:path';
import { z } from 'zod';
import { Ripgrep } from '@ai-team/fs';
import type { AgentTool, ToolContext } from '../types/index.js';
import { ContextManager } from '../context/index.js';

/**
 * Find symbol definitions in a file or across files
 */
export const findSymbolTool: AgentTool = {
  name: 'find_symbol',
  description: 'Find symbol definitions (functions, classes, variables) in code. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Name of the symbol to find'),
    filePath: z.string().optional().describe('Specific file to search (omit to search all readable files)'),
    language: z.string().default('typescript').describe('Language (typescript, javascript, python, etc.)'),
  }),
  async execute(params, context: ToolContext) {
    const { SymbolFinder } = await import('../code-analysis/index.js');
    const { symbolName, filePath } = params as any;

    const finder = new SymbolFinder();
    
    try {
      await finder.initialize();
      
      // TODO: Load language grammar (needs language WASM files)
      // For now, return a placeholder indicating the feature needs language grammars
      return {
        error: 'Symbol finding requires language grammar files to be loaded. This feature is pending configuration.',
        symbolName,
        filePath,
      };
    } finally {
      finder.dispose();
    }
  },
};

/**
 * Find all references to a symbol
 */
export const findReferencesTool: AgentTool = {
  name: 'find_references',
  description: 'Find all references/usages of a symbol across files. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Symbol name to find references for'),
    filePatterns: z.array(z.string()).optional().describe('Glob patterns for files to search'),
    language: z.string().default('typescript').describe('Language (typescript, javascript, python, etc.)'),
  }),
  async execute(params, context: ToolContext) {
    const { symbolName, filePatterns } = params as any;
    
    // TODO: Implement with tree-sitter once language grammars are configured
    return {
      error: 'Reference finding requires language grammar files to be loaded. This feature is pending configuration.',
      symbolName,
      filePatterns,
    };
  },
};

/**
 * Find code patterns (anti-patterns, TODO comments, etc.)
 */
export const findPatternTool: AgentTool = {
  name: 'find_pattern',
  description: 'Find code patterns like console.log, TODO comments, empty catch blocks, etc. Requires read permission.',
  parameters: z.object({
    patternType: z.enum(['console-log', 'todo-comment', 'empty-catch', 'async-without-await']).describe('Type of pattern to find'),
    filePatterns: z.array(z.string()).optional().describe('Glob patterns for files to search'),
    language: z.string().default('typescript').describe('Language to analyze'),
  }),
  async execute(params, context: ToolContext) {
    const { patternType, filePatterns } = params as any;
    
    // TODO: Implement with tree-sitter once language grammars are configured
    return {
      error: 'Pattern matching requires language grammar files to be loaded. This feature is pending configuration.',
      patternType,
      filePatterns,
    };
  },
};

/**
 * Fast grep-style text search
 */
export const grepCodeTool: AgentTool = {
  name: 'search_grep',
  description: 'Fast regex or literal text search in workspace files, powered by ripgrep. Returns structured match objects with file path, line number, and matched content. Requires read permission.',
  parameters: z.object({
    pattern:       z.string().describe('Regex or literal text to search for'),
    filePatterns:  z.array(z.string()).optional().describe('Glob patterns to restrict files (e.g. ["**/*.ts"])'),
    caseSensitive: z.boolean().optional().describe('Force case-sensitive match (default: ripgrep smart-case)'),
    limit:         z.number().int().min(1).optional().describe('Max matches to return per file (default: unlimited)'),
  }),
  async execute(params, context: ToolContext) {
    const { pattern, filePatterns, limit } = params as {
      pattern: string;
      filePatterns?: string[];
      limit?: number;
    };

    const matches = await Ripgrep.search({
      cwd:     context.workspaceRoot,
      pattern,
      glob:    filePatterns,
      limit,
      follow:  false,
    });

    return {
      pattern,
      matchCount: matches.length,
      fileCount:  new Set(matches.map((m) => m.path.text)).size,
      matches: matches.slice(0, 200).map((m) => ({
        filePath:   m.path.text,
        lineNumber: m.line_number,
        line:       m.lines.text.trimEnd(),
        submatches: m.submatches.map((s) => s.match.text),
      })),
    };
  },
};

/**
 * Analyze TypeScript/JavaScript code complexity
 */
export const analyzeComplexityTool: AgentTool = {
  name: 'analyze_complexity',
  description: 'Analyze code complexity metrics (cyclomatic complexity, LOC, etc.) for TypeScript/JavaScript files. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('File path to analyze'),
    functionName: z.string().optional().describe('Specific function to analyze (omit for all functions)'),
  }),
  async execute(params, context: ToolContext) {
    const { TypeScriptAnalyzer } = await import('../code-analysis/index.js');
    const { filePath, functionName } = params as any;
    
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);
    
    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    contextManager.assertCanRead(context.agent, absolutePath);
    
    const analyzer = new TypeScriptAnalyzer();
    
    if (functionName) {
      const complexity = await analyzer.calculateComplexity(absolutePath, functionName);
      return { filePath, functionName, complexity };
    } else {
      const functions = await analyzer.getFunctions(absolutePath);
      return { filePath, functions };
    }
  },
};

/**
 * Propose code edits for user approval
 */
export const applyCodeEditTool: AgentTool = {
  name: 'fs_apply_patch',
  description: 'Propose code changes to one or more files. Changes must be approved by the user before being applied. Requires write permission for all files.',
  parameters: z.object({
    description: z.string().describe('Clear description of what changes are being made and why'),
    changes: z.array(z.object({
      filePath: z.string().describe('File path (relative or absolute)'),
      oldContent: z.string().describe('Current content of the file'),
      newContent: z.string().describe('New content after changes'),
    })).min(1).describe('List of file changes to apply'),
  }),
  async execute(params, context: ToolContext) {
    const { CodeEditManager } = await import('../code-edit/index.js');
    const { description, changes } = params as any;
    
    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    const editManager = new CodeEditManager();
    
    // Convert paths to absolute
    const absoluteChanges = changes.map((change: any) => ({
      ...change,
      filePath: path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(context.workspaceRoot, change.filePath),
    }));
    
    // Validate permissions for all files
    const filePaths = absoluteChanges.map((c: any) => c.filePath);
    const validation = contextManager.validateEditProposal(context.agent, filePaths);
    
    if (!validation.allowed) {
      const blockedFiles = contextManager.getBlockedFiles(context.agent, validation.blockedFiles);
      
      return {
        status: 'permission_denied',
        message: validation.message,
        blockedFiles: blockedFiles.map(bf => ({
          filePath: bf.relativePath,
          reason: bf.reason,
        })),
      };
    }
    
    // Create proposal
    const { proposal, validation: proposalValidation } = await editManager.createProposal(
      context.agent.id,
      {
        description,
        changes: absoluteChanges,
      },
      {
        checkPermissions: true,
        maxFiles: 10,
        maxDiffLines: 500,
      }
    );
    
    return {
      status: 'pending_approval',
      proposalId: proposal.id,
      description: proposal.description,
      filesChanged: proposal.changes.length,
      additions: proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0),
      deletions: proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0),
      warnings: proposalValidation.warnings,
      message: 'Code edit proposal created. Awaiting user approval.',
    };
  },
};
