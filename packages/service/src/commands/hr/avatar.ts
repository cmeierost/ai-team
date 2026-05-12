import fs from 'node:fs/promises';
import type {
  Agent,
  TeamConfig,
  LlmProviderConfig,
  IAgentManager,
  IConfigurationStorage,
  IEnvironmentStorage,
  IAvatarManager,
} from '@ai-team/core';
import type {
  AvatarOptions,
  InteractionContext,
  QuestionSelectChoice,
} from '@ai-team/api-contracts';

interface AvatarSource {
  type: 'random' | 'generate' | 'custom';
  urlIndex?: number;
  provider?: [string, LlmProviderConfig];
  modelName?: string;
  prompt?: string;
  customUrl?: string;
}

export class AvatarService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly avatarManager: IAvatarManager
  ) {}

  async execute(options: AvatarOptions, context: InteractionContext): Promise<void> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const agent = await this.agentManager.resolveAgentOrThrowAsync(options.agentQuery);
    this.emitLog(context, `Found agent: ${agent.name}`);

    const teamConfig = await this.configurationStorage.loadTeamConfigAsync(workspaceRoot);
    if (!teamConfig) {
      throw new Error('Team config not found. Run `ait init` first.');
    }

    const success = await this.avatarSelectionFlow(agent, workspaceRoot, teamConfig, context);
    if (!success) {
      this.emitLog(context, 'Avatar selection cancelled.');
    }
  }

  private async avatarSelectionFlow(
    agent: Agent,
    workspaceRoot: string,
    teamConfig: TeamConfig,
    context: InteractionContext
  ): Promise<boolean> {
    if (!context.questionSelect || !context.questionConfirm || !context.questionInput) {
      throw new Error('Avatar selection requires question responders.');
    }

    try {
      const sourceType = await this.askAvatarSource(teamConfig, context);
      if (!sourceType) {
        this.emitLog(context, 'No avatar sources configured.');
        return false;
      }

      const source: AvatarSource = { type: sourceType };

      if (sourceType === 'random') {
        const randomUrls = teamConfig.randomAvatarUrls || [];
        source.urlIndex = await this.askRandomUrl(randomUrls, context);
      } else if (sourceType === 'generate') {
        const aiConfig = await this.askAiGeneration(agent, teamConfig, context);
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

      const approved = await this.previewAndApproveLoop(
        agent,
        source,
        teamConfig,
        workspaceRoot,
        context
      );
      if (!approved) return false;

      this.emitLog(context, 'Finalizing avatar...');
      const avatarPath = await this.avatarManager.finalizeAvatar(agent.id, workspaceRoot);
      await this.avatarManager.updateAgentAvatar(agent, avatarPath, workspaceRoot);
      this.emitLog(context, `✓ Avatar saved for ${agent.name}`);
      this.emitLog(context, `  Path: ${avatarPath}`);
      return true;
    } catch (error) {
      this.emitLog(context, `✗ Error: ${(error as Error).message}`, 'error');
      await this.avatarManager.cleanupPreview(agent.id, workspaceRoot);
      return false;
    }
  }

  private async askAvatarSource(
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

  private async askRandomUrl(randomUrls: string[], context: InteractionContext): Promise<number> {
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

    return Number.parseInt(selected, 10);
  }

  private async askAiGeneration(
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

    const defaultPrompt = this.avatarManager.buildAvatarPrompt(agent);
    this.emitLog(context, `Default prompt: ${defaultPrompt}`);

    const promptValue = await context.questionInput!({
      message: 'Avatar generation prompt (press Enter to use default):',
    });

    return {
      provider: selectedProvider,
      modelName: selectedModelName,
      prompt: promptValue?.trim() || defaultPrompt,
    };
  }

  private async previewAndApproveLoop(
    agent: Agent,
    source: AvatarSource,
    teamConfig: TeamConfig,
    workspaceRoot: string,
    context: InteractionContext
  ): Promise<boolean> {
    while (true) {
      this.emitLog(context, 'Generating avatar...');

      try {
        const imageData = await this.generateAvatarImage(source, agent, teamConfig, workspaceRoot);
        const previewPath = await this.avatarManager.saveAvatarPreview(
          agent.id,
          imageData,
          workspaceRoot
        );
        this.emitLog(context, `✓ Preview saved: ${previewPath}`);

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

        await this.avatarManager.cleanupPreview(agent.id, workspaceRoot);
        this.emitLog(context, "Let's try another one...");
      } catch (error) {
        this.emitLog(context, `✗ Error generating avatar: ${(error as Error).message}`, 'error');
        await this.avatarManager.cleanupPreview(agent.id, workspaceRoot);

        const retry = await context.questionConfirm!({
          message: 'Try again?',
          default: true,
        });

        if (!retry) return false;
      }
    }
  }

  private async generateAvatarImage(
    source: AvatarSource,
    agent: Agent,
    teamConfig: TeamConfig,
    workspaceRoot: string
  ): Promise<Buffer> {
    const randomUrls = teamConfig.randomAvatarUrls || [];

    if (source.type === 'random') {
      const urlTemplate = randomUrls[source.urlIndex || 0];
      return this.avatarManager.downloadRandomAvatar(urlTemplate, agent);
    }

    if (source.type === 'custom') {
      return this.avatarManager.downloadRandomAvatar(source.customUrl!, agent);
    }

    const [, providerConfig] = source.provider!;
    const apiKeyVar = providerConfig.apiKeyEnvVar || 'OPENAI_API_KEY';

    const envFile = await this.environmentStorage.loadEnvFileAsync(workspaceRoot);
    const apiKey = envFile[apiKeyVar] || process.env[apiKeyVar];

    if (!apiKey) {
      throw new Error(
        `API key not found in environment variable: ${apiKeyVar}\n` +
          'Set the API key in .ai-team/.env or your shell environment.'
      );
    }

    return this.avatarManager.generateAvatarWithAI(
      source.prompt!,
      providerConfig,
      source.modelName!,
      apiKey
    );
  }

  private emitLog(
    context: InteractionContext,
    message: string,
    level: 'info' | 'warn' | 'error' = 'info'
  ) {
    context.emit?.({ kind: 'log', level, message });
  }
}
