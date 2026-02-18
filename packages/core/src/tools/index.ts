/**
 * Tool system - defines tools that agents can use
 * Mirrors VS Code Copilot capabilities (Feb 2026)
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { z } from 'zod';
import {
  AgentTool,
  ToolContext,
} from '../types/index.js';
import { ContextManager } from '../context/index.js';

// ============================================================================
// Core File Tools
// ============================================================================

/**
 * Read file contents with permission checking
 */
export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read contents of a file. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().optional().describe('1-based line number to start reading from'),
    endLine: z.number().optional().describe('1-based line number to end reading at'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, startLine, endLine } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanRead(context.agent, absolutePath);

    const content = await fs.readFile(absolutePath, 'utf-8');
    
    if (startLine !== undefined && endLine !== undefined) {
      const lines = content.split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    }
    
    return content;
  },
};

/**
 * Search for files by glob pattern
 */
export const fileSearchTool: AgentTool = {
  name: 'file_search',
  description: 'Find files matching a glob pattern. Returns only files the agent has permission to read.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { pattern, maxResults = 100 } = params as any;
    
    const files = await glob(pattern, {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    return readableFiles.slice(0, maxResults);
  },
};

/**
 * Write or modify file contents
 */
export const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Write or modify file contents. Requires write permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('New file content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, content, createDirectories = false } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanWrite(context.agent, absolutePath);

    if (createDirectories) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await fs.writeFile(absolutePath, content, 'utf-8');
    return { success: true, path: absolutePath };
  },
};

// ============================================================================
// Search & Analysis Tools
// ============================================================================

/**
 * Semantic search across codebase (placeholder - would integrate with vector DB)
 */
export const semanticSearchTool: AgentTool = {
  name: 'semantic_search',
  description: 'Search codebase semantically for relevant code and documentation.',
  parameters: z.object({
    query: z.string().describe('Natural language search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { query, maxResults = 10 } = params as any;
    
    // Placeholder: In production, this would query a vector database
    // For now, return empty results
    return {
      query,
      results: [],
      note: 'Semantic search requires vector database integration',
    };
  },
};

/**
 * Get compiler/linter errors
 */
export const getErrorsTool: AgentTool = {
  name: 'get_errors',
  description: 'Get compile or lint errors for specified files.',
  parameters: z.object({
    filePaths: z.array(z.string()).optional().describe('Files to check (omit for all files)'),
  }),
  async execute(params, context: ToolContext) {
    // Placeholder: Would integrate with LSP or build system
    return {
      errors: [],
      note: 'Error checking requires LSP or build system integration',
    };
  },
};

// ============================================================================
// Agent Collaboration Tools
// ============================================================================

/**
 * Delegate task to another agent
 */
export const delegateToAgentTool: AgentTool = {
  name: 'delegate_to_agent',
  description: 'Delegate a task to another agent. Checks delegation permissions.',
  parameters: z.object({
    agentId: z.string().describe('Target agent ID'),
    task: z.string().describe('Task description'),
    context: z.array(z.string()).optional().describe('File paths for context'),
  }),
  async execute(params, context: ToolContext) {
    const { agentId, task, context: contextFiles } = params as any;
    
    // Check if agent can delegate to target
    if (!context.agent.delegatesTo?.includes(agentId)) {
      throw new Error(`Agent ${context.agent.id} cannot delegate to ${agentId}`);
    }

    return {
      delegatedTo: agentId,
      task,
      contextFiles,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Ask human for clarification
 */
export const askHumanTool: AgentTool = {
  name: 'ask_human',
  description: 'Request clarification or input from the human developer.',
  parameters: z.object({
    question: z.string().describe('Question to ask'),
    context: z.string().optional().describe('Additional context'),
  }),
  async execute(params, context: ToolContext) {
    const { question, context: additionalContext } = params as any;
    
    return {
      question,
      context: additionalContext,
      requestedBy: context.agent.id,
      timestamp: new Date().toISOString(),
    };
  },
};

// ============================================================================
// HR Tools (restricted to HR Director)
// ============================================================================

/**
 * Create a new agent
 */
export const createAgentTool: AgentTool = {
  name: 'create_agent',
  description: 'Create a new virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    name: z.string(),
    role: z.string(),
    contextLevel: z.string(),
    reportsTo: z.string().optional(),
    features: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to create agents`);
    }

    // Placeholder: Would call AgentManager.createAgent()
    return {
      action: 'create_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Archive an agent
 */
export const archiveAgentTool: AgentTool = {
  name: 'archive_agent',
  description: 'Archive (offboard) a virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().describe('Agent ID to archive'),
    reason: z.string().optional().describe('Reason for archiving'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to archive agents`);
    }

    return {
      action: 'archive_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Assess agent performance
 */
export const assessPerformanceTool: AgentTool = {
  name: 'assess_performance',
  description: 'Analyze agent activity and performance metrics. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().optional().describe('Specific agent (omit for all)'),
    period: z.string().optional().describe('Time period (e.g., "last-30-days")'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to assess performance`);
    }

    // Placeholder: Would analyze chat logs and meeting summaries
    return {
      action: 'assess_performance',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const CORE_TOOLS: Record<string, AgentTool> = {
  read_file: readFileTool,
  file_search: fileSearchTool,
  write_file: writeFileTool,
  semantic_search: semanticSearchTool,
  get_errors: getErrorsTool,
  delegate_to_agent: delegateToAgentTool,
  ask_human: askHumanTool,
};

export const HR_TOOLS: Record<string, AgentTool> = {
  create_agent: createAgentTool,
  archive_agent: archiveAgentTool,
  assess_performance: assessPerformanceTool,
};

export const ALL_TOOLS: Record<string, AgentTool> = {
  ...CORE_TOOLS,
  ...HR_TOOLS,
};

/**
 * Get tools available to an agent
 * @param agent - Agent to get tools for
 * @returns Map of tool name to tool definition
 */
export function getAgentTools(agent: { tools?: string[]; permissions?: { manage_agents?: boolean } }): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {};
  
  // Add explicitly granted tools
  if (agent.tools) {
    for (const toolName of agent.tools) {
      if (ALL_TOOLS[toolName]) {
        tools[toolName] = ALL_TOOLS[toolName];
      }
    }
  }
  
  // Add HR tools if agent has permission
  if (agent.permissions?.manage_agents) {
    Object.assign(tools, HR_TOOLS);
  }
  
  return tools;
}
