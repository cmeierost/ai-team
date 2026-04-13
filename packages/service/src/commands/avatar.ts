import fs from 'node:fs/promises';
import {
  AgentManager,
  loadTeamConfig,
  loadEnvFile,
  downloadRandomAvatar,
  generateAvatarWithAI,
  buildAvatarPrompt,
  saveAvatarPreview,
  finalizeAvatar,
  updateAgentAvatar,
  cleanupPreview,
} from '@ai-team/infrastructure';
import type { Agent, TeamConfig, LlmProviderConfig } from '@ai-team/infrastructure';
import type { AvatarOptions, InteractionContext, QuestionSelectChoice } from '@ai-team/api-client';

// ── Public entry point ────────────────────────────────────────────────────────

export async function avatarCommand(
  workspaceRoot: string,
  options: AvatarOptions,
  context: InteractionContext = {}
) {
  const agentManager = new AgentManager(workspaceRoot);
  const agent = await agentManager.resolveAgentOrThrowAsync(options.agentQuery);
  emitLog(context, `Found agent: ${agent.name}`);

  const teamConfig = await loadTeamConfig(workspaceRoot);
  if (!teamConfig) {
    throw new Error('Team config not found. Run `ait init` first.');
  }

  const success = await avatarSelectionFlow(agent, workspaceRoot, teamConfig, context);
  if (!success) {
    emitLog(context, 'Avatar selection cancelled.');
  }
}

// ── Avatar selection flow ─────────────────────────────────────────────────────

interface AvatarSource {
  type: 'random' | 'generate' | 'custom';
  urlIndex?: number;
  provider?: [string, LlmProviderConfig];
  modelName?: string;
  prompt?: string;
  customUrl?: string;
}

async function avatarSelectionFlow(
  agent: Agent,
  workspaceRoot: string,
  teamConfig: TeamConfig,
  context: InteractionContext
): Promise<boolean> {
  if (!context.questionSelect || !context.questionConfirm || !context.questionInput) {
    throw new Error('Avatar selection requires question responders.');
  }

  try {
    // Step 1: Source selection
    const sourceType = await askAvatarSource(teamConfig, context);
    if (!sourceType) {
      emitLog(context, 'No avatar sources configured.');
      return false;
    }

    const source: AvatarSource = { type: sourceType };

    // Step 2: Source-specific configuration
    if (sourceType === 'random') {
      const randomUrls = teamConfig.randomAvatarUrls || [];
      source.urlIndex = await askRandomUrl(randomUrls, context);
    } else if (sourceType === 'generate') {
      const aiConfig = await askAiGeneration(agent, teamConfig, context);
      source.provider = aiConfig.provider;
      source.modelName = aiConfig.modelName;
      source.prompt = aiConfig.prompt;
    } else if (sourceType === 'custom') {
      source.customUrl = await context.questionInput({
        message: 'Enter image URL:',
        validate: (v) => {
          const trimmed = v.trim();
          if (!trimmed) return 'URL is required';
          try {
            new URL(trimmed);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      });
    }

    // Step 3: Preview and approval loop
    const approved = await previewAndApproveLoop(agent, source, teamConfig, workspaceRoot, context);
    if (!approved) return false;

    // Step 4: Finalize
    emitLog(context, 'Finalizing avatar...');
    const avatarPath = await finalizeAvatar(agent.id, workspaceRoot);
    await updateAgentAvatar(agent, avatarPath, workspaceRoot);
    emitLog(context, `✓ Avatar saved for ${agent.name}`);
    emitLog(context, `  Path: ${avatarPath}`);
    return true;
  } catch (error) {
    emitLog(context, `✗ Error: ${(error as Error).message}`, 'error');
    await cleanupPreview(agent.id, workspaceRoot);
    return false;
  }
}

// ── Question flows ────────────────────────────────────────────────────────────

async function askAvatarSource(
  teamConfig: TeamConfig,
  context: InteractionContext
): Promise<AvatarSource['type'] | null> {
  const randomUrls = teamConfig.randomAvatarUrls || [];
  const providers = teamConfig.providers || {};
  const imageCapableProviders = Object.entries(providers).filter(
    ([, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
  );

  const choices: QuestionSelectChoice[] = [];

  if (randomUrls.length > 0) {
    choices.push({
      name: 'Random (download from URL)',
      value: 'random',
      description: `${randomUrls.length} source${randomUrls.length > 1 ? 's' : ''} available`,
    });
  }

  if (imageCapableProviders.length > 0) {
    choices.push({
      name: 'AI-generated (image model)',
      value: 'generate',
      description: `${imageCapableProviders.length} provider${imageCapableProviders.length > 1 ? 's' : ''} available`,
    });
  }

  choices.push({
    name: 'Custom URL (paste any image URL)',
    value: 'custom',
    description: 'Download from any image URL',
  });

  if (choices.length === 0) return null;

  return (await context.questionSelect!({
    message: 'Avatar source:',
    choices,
  })) as AvatarSource['type'];
}

async function askRandomUrl(randomUrls: string[], context: InteractionContext): Promise<number> {
  if (randomUrls.length === 1) return 0;

  const choices = randomUrls.map((url, index) => {
    const domainMatch = /https?:\/\/([^/]+)/.exec(url);
    const domain = domainMatch?.[1] || url;
    return { name: `${domain} - ${url}`, value: String(index) };
  });

  const selected = await context.questionSelect!({
    message: 'Select random avatar source:',
    choices,
  });

  return parseInt(selected, 10);
}

async function askAiGeneration(
  agent: Agent,
  teamConfig: TeamConfig,
  context: InteractionContext
): Promise<{ provider: [string, LlmProviderConfig]; modelName: string; prompt: string }> {
  const providers = teamConfig.providers || {};
  const imageCapableProviders = Object.entries(providers).filter(
    ([, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
  );

  let selectedProvider: [string, LlmProviderConfig];

  if (imageCapableProviders.length > 1) {
    const choices = imageCapableProviders.map(([name, config]) => ({
      name: `${name} (${Object.keys(config.imageModels!).length} model${Object.keys(config.imageModels!).length > 1 ? 's' : ''})`,
      value: name,
    }));

    const selectedName = await context.questionSelect!({
      message: 'Select image generation provider:',
      choices,
    });

    selectedProvider = imageCapableProviders.find(([name]) => name === selectedName)!;
  } else {
    selectedProvider = imageCapableProviders[0];
  }

  // Select model
  const imageModels = selectedProvider[1].imageModels!;
  const modelKeys = Object.keys(imageModels);
  let selectedModelName: string;

  if (modelKeys.length > 1) {
    const choices = modelKeys.map((key) => ({
      name: `${key}: ${imageModels[key]}`,
      value: key,
    }));

    const selectedKey = await context.questionSelect!({
      message: 'Select image model:',
      choices,
    });

    selectedModelName = imageModels[selectedKey];
  } else {
    selectedModelName = imageModels[modelKeys[0]];
  }

  // Prompt
  const defaultPrompt = buildAvatarPrompt(agent);
  emitLog(context, `Default prompt: ${defaultPrompt}`);

  const promptValue = await context.questionInput!({
    message: 'Avatar generation prompt (press Enter to use default):',
  });

  return {
    provider: selectedProvider,
    modelName: selectedModelName,
    prompt: promptValue?.trim() || defaultPrompt,
  };
}

// ── Preview and approval ──────────────────────────────────────────────────────

async function previewAndApproveLoop(
  agent: Agent,
  source: AvatarSource,
  teamConfig: TeamConfig,
  workspaceRoot: string,
  context: InteractionContext
): Promise<boolean> {
  while (true) {
    emitLog(context, 'Generating avatar...');

    try {
      const imageData = await generateAvatarImage(source, agent, teamConfig, workspaceRoot);
      const previewPath = await saveAvatarPreview(agent.id, imageData, workspaceRoot);
      emitLog(context, `✓ Preview saved: ${previewPath}`);

      // Emit avatar-preview event so the adapter can display it
      let imageBase64: string | undefined;
      try {
        const data = await fs.readFile(previewPath);
        imageBase64 = data.toString('base64');
      } catch {
        /* non-critical — CLI will use file path */
      }

      context.emit?.({
        kind: 'avatar-preview',
        agentId: agent.id,
        agentName: agent.name,
        previewPath,
        imageBase64,
      });

      const approved = await context.questionConfirm!({
        message: 'Do you like this avatar?',
        default: true,
      });

      if (approved) return true;

      await cleanupPreview(agent.id, workspaceRoot);
      emitLog(context, "Let's try another one...");
    } catch (error) {
      emitLog(context, `✗ Error generating avatar: ${(error as Error).message}`, 'error');
      await cleanupPreview(agent.id, workspaceRoot);

      const retry = await context.questionConfirm!({
        message: 'Try again?',
        default: true,
      });

      if (!retry) return false;
    }
  }
}

async function generateAvatarImage(
  source: AvatarSource,
  agent: Agent,
  teamConfig: TeamConfig,
  workspaceRoot: string
): Promise<Buffer> {
  const randomUrls = teamConfig.randomAvatarUrls || [];

  if (source.type === 'random') {
    const urlTemplate = randomUrls[source.urlIndex || 0];
    emitLog({ emit: undefined }, ''); // Intentionally not logging URL to avoid leaking
    return downloadRandomAvatar(urlTemplate, agent);
  }

  if (source.type === 'custom') {
    return downloadRandomAvatar(source.customUrl!, agent);
  }

  // AI generation
  const [, providerConfig] = source.provider!;
  const apiKeyVar = providerConfig.apiKeyEnvVar || 'OPENAI_API_KEY';

  // Try .env file first, then process.env
  const envFile = await loadEnvFile(workspaceRoot);
  const apiKey = envFile[apiKeyVar] || process.env[apiKeyVar];

  if (!apiKey) {
    throw new Error(
      `API key not found in environment variable: ${apiKeyVar}\n` +
        'Set the API key in .ai-team/.env or your shell environment.'
    );
  }

  return generateAvatarWithAI(source.prompt!, providerConfig, source.modelName!, apiKey);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emitLog(
  context: InteractionContext,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info'
) {
  context.emit?.({ kind: 'log', level, message });
}
