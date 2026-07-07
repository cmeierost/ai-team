import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { saveOnboardingTranscriptAsync } from '../init/onboarding-docs.js';

const chatMessageSchema = z.looseObject({
  timestamp: z.string(),
  from: z.string(),
  to: z.string(),
  content: z.string(),
  isHuman: z.boolean().optional(),
});

const saveTranscriptParamsSchema = z.object({
  relativePath: z
    .string()
    .min(1)
    .describe('Workspace-relative path of the markdown file to write (e.g. `.ai-team/business.md`).'),
  title: z.string().min(1).describe('Top-level `# heading` of the transcript document.'),
  intro: z
    .array(z.string())
    .default([])
    .describe('Lines inserted between the title and the transcript body.'),
  messages: z
    .array(chatMessageSchema)
    .describe('Chat history to render. Typically `{{chat_phase.messages}}` from a prior step.'),
  agentLabel: z
    .string()
    .min(1)
    .describe('Speaker label for the agent (e.g. `"Alice (CEO)"`).'),
  developerLabel: z
    .string()
    .optional()
    .describe('Speaker label for the developer. Defaults to "Developer".'),
});

export type SaveTranscriptParams = z.infer<typeof saveTranscriptParamsSchema>;

export interface SaveTranscriptResult {
  filePath: string;
}

export const SaveTranscriptCommandMetadata = {
  key: 'save_transcript',
  group: 'docs',
  description:
    'Render a chat history as a markdown transcript and write it to the workspace. Creates parent directories as needed.',
  availableIn: { tool: true },
  parameters: saveTranscriptParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'docs'],
} satisfies ICommandDescriptor;

/**
 * `save_transcript` — write a chat-phase transcript as markdown.
 *
 * Thin wrapper over `saveOnboardingTranscriptAsync()`. Use after a `chat_phase`
 * step to persist its messages to a known location for downstream tooling.
 */
export class SaveTranscriptCommand
  implements ICommand<SaveTranscriptParams, SaveTranscriptResult>
{
  readonly metadata = SaveTranscriptCommandMetadata;

  constructor(private readonly workspaceRoot: string) {}

  async execute(
    params: SaveTranscriptParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<SaveTranscriptResult>> {
    const workspaceRoot = this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'save_transcript requires a workspaceRoot in context.' };
    }

    const filePath = await saveOnboardingTranscriptAsync({
      workspaceRoot,
      relativePath: params.relativePath,
      title: params.title,
      intro: params.intro,
      history: params.messages,
      developerLabel: params.developerLabel,
      agentLabel: params.agentLabel,
    });

    return { status: 'ok', data: { filePath } };
  }
}
