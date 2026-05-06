import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NoteAttachment } from '../storage/contracts.js';
import type { ILlmToolDefinition, ILlmToolCall, ILlmToolResult } from '@ai-team/core';

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.env',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.xml',
  '.svg',
  '.csv',
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  '.tf',
  '.hcl',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function isSupportedTextFile(attachment: NoteAttachment): boolean {
  const ext = path.extname(attachment.fileName).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const ct = attachment.contentType ?? '';
  return ct.startsWith('text/') || ct === 'application/json';
}

function isPdf(attachment: NoteAttachment): boolean {
  const ext = path.extname(attachment.fileName).toLowerCase();
  return ext === '.pdf' || attachment.contentType === 'application/pdf';
}

export function isImageAttachment(attachment: NoteAttachment): boolean {
  const ext = path.extname(attachment.fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return true;
  const contentType = attachment.contentType ?? '';
  return contentType.startsWith('image/');
}

export async function readAttachmentAsDataUrlAsync(attachment: NoteAttachment): Promise<string> {
  const buffer = await readFile(attachment.filePath);
  const ext = path.extname(attachment.fileName).toLowerCase();
  const contentType =
    attachment.contentType || mimeTypeFromExtension(ext) || 'application/octet-stream';
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function mimeTypeFromExtension(ext: string): string | undefined {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}

export async function extractAttachmentContentAsync(attachment: NoteAttachment): Promise<string> {
  if (isPdf(attachment)) {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await readFile(attachment.filePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }

  if (isSupportedTextFile(attachment)) {
    return readFile(attachment.filePath, 'utf-8');
  }

  throw new Error(
    `Unsupported file type for "${attachment.fileName}". Only PDF and text/code files are supported.`
  );
}

export interface AttachmentReaderTool {
  toolDef: ILlmToolDefinition;
  executeTool: (toolCall: ILlmToolCall) => Promise<ILlmToolResult>;
}

/**
 * Builds a one-shot `read_attachment_file` tool scoped to a specific note attachment.
 */
export function buildAttachmentReaderTool(attachment: NoteAttachment): AttachmentReaderTool {
  const toolDef: ILlmToolDefinition = {
    name: 'read_attachment_file',
    description: `Read the full contents of the note's attached file "${attachment.fileName}". Use this to understand the file content before writing the summary.`,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  const executeTool = async (toolCall: ILlmToolCall): Promise<ILlmToolResult> => {
    try {
      const content = await extractAttachmentContentAsync(attachment);
      return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        result: { content },
      };
    } catch (error) {
      return {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        result: { error: error instanceof Error ? error.message : String(error) },
        isError: true,
      };
    }
  };

  return { toolDef, executeTool };
}

export function splitIntoChunks(text: string, maxCharsPerChunk = 5000): string[] {
  if (text.length <= maxCharsPerChunk) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxCharsPerChunk, text.length);

    if (end < text.length) {
      const searchStart = Math.max(start, end - 400);
      const tail = text.slice(searchStart, end);
      const paragraphBreak = tail.lastIndexOf('\n\n');
      if (paragraphBreak > 0) {
        end = searchStart + paragraphBreak;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    start = end;
  }

  return chunks;
}
