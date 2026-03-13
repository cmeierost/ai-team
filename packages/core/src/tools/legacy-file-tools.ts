import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { z } from 'zod';
import type { AgentTool } from '../types/index.js';
import { ContextManager } from '../context/index.js';

export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read contents of a file. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().optional().describe('1-based line number to start reading from'),
    endLine: z.number().optional().describe('1-based line number to end reading at'),
  }),
  async execute(params, context) {
    const { filePath, startLine, endLine } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    contextManager.assertCanRead(context.agent, absolutePath);

    const content = await fs.readFile(absolutePath, 'utf-8');

    if (startLine !== undefined && endLine !== undefined) {
      const lines = content.split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    }

    return content;
  },
};

export const fileSearchTool: AgentTool = {
  name: 'file_search',
  description: 'Find files matching a glob pattern. Returns only files the agent has permission to read.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context) {
    const { pattern, maxResults = 100 } = params as any;

    const files = await glob(pattern, {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    return readableFiles.slice(0, maxResults);
  },
};

export const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Write or modify file contents. Requires write permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('New file content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context) {
    const { filePath, content, createDirectories = false } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot, undefined, context.accessEngine);
    contextManager.assertCanWrite(context.agent, absolutePath);

    if (createDirectories) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await fs.writeFile(absolutePath, content, 'utf-8');
    return { success: true, path: absolutePath };
  },
};
