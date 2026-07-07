import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import {
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
  createBootstrapWorkspaceFiles,
  createRoleTemplates,
} from '../init/bootstrap-files.js';
import {
  INIT_TEMPLATE_FILE_MAP,
  getWorkspaceTemplatePath,
  loadInitTemplates,
  readDefaultTemplate,
  type InitTemplateKey,
} from '../init/template-utils.js';

const bootstrapFilesParamsSchema = z.object({
  workspaceRoot: z
    .string()
    .optional()
    .describe(
      'Workspace root to seed. When omitted, falls back to the workspaceRoot from execution context.'
    ),
});

export type BootstrapFilesParams = z.infer<typeof bootstrapFilesParamsSchema>;

export interface BootstrapFilesResult {
  workspaceRoot: string;
}

export const BootstrapFilesCommandMetadata = {
  key: 'bootstrap_files',
  group: 'init',
  description:
    'Seed the workspace with `.ai-team/` templates, role files, bootstrap docs, instructions, and skills. Idempotent: existing files are not overwritten.',
  availableIn: { tool: true },
  parameters: bootstrapFilesParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init'],
} satisfies ICommandDescriptor;

/**
 * `bootstrap_files` — seeds the workspace with the default `.ai-team/` layout.
 *
 * Composes the same sequence used by `OnboardCommand` and the CLI `init` flow:
 * 1. Write default template files into `.ai-team/templates/init/` (if missing)
 * 2. Load them back as the active `InitTemplates`
 * 3. Create bootstrap workspace files (`AGENTS.md`, copilot instructions, ai-team-way)
 * 4. Create instruction files under `.ai-team/instructions/`
 * 5. Create the `agent-authoring` skill scaffold
 * 6. Create role templates under `.ai-team/roles/` and matching docs
 *
 * All steps use `writeFileIfMissing` semantics so re-running is safe.
 */
export class BootstrapFilesCommand implements ICommand<BootstrapFilesParams, BootstrapFilesResult> {
  readonly metadata = BootstrapFilesCommandMetadata;

  constructor(private readonly workspaceRoot: string) {}

  async execute(
    params: BootstrapFilesParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<BootstrapFilesResult>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'bootstrap_files requires a workspaceRoot.' };
    }

    const writeFileIfMissing = async (filePath: string, content: string): Promise<void> => {
      try {
        await fs.access(filePath);
      } catch {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
      }
    };

    await createBootstrapTemplateFiles(workspaceRoot, {
      templateKeys: Object.keys(INIT_TEMPLATE_FILE_MAP) as InitTemplateKey[],
      readDefaultTemplate,
      getWorkspaceTemplatePath,
      writeFileIfMissing,
    });

    const templates = await loadInitTemplates(workspaceRoot);
    await createBootstrapWorkspaceFiles(workspaceRoot, templates, writeFileIfMissing);
    await createBootstrapInstructions(workspaceRoot, templates, writeFileIfMissing);
    await createBootstrapSkills(workspaceRoot, templates);
    await createRoleTemplates(workspaceRoot, templates);

    return { status: 'ok', data: { workspaceRoot } };
  }
}
