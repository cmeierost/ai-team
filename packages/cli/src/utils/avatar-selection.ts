import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import chalk from 'chalk';
import { confirm, select, input } from '@inquirer/prompts';
import {
  downloadRandomAvatar,
  generateAvatarWithAI,
  buildAvatarPrompt,
  saveAvatarPreview,
  finalizeAvatar,
  updateAgentAvatar,
  cleanupPreview,
  type Agent,
  type LlmProviderConfig,
  type TeamConfig,
} from '@ai-team/infrastructure';

const execAsync = promisify(exec);

export interface AvatarSource {
  type: 'random' | 'generate' | 'custom';
  urlIndex?: number;
  provider?: [string, LlmProviderConfig];
  modelName?: string;
  prompt?: string;
  customUrl?: string;
}

/**
 * Prompts user to select avatar source type (random/AI-generate/custom)
 */
export async function promptForAvatarSource(
  teamConfig: TeamConfig
): Promise<AvatarSource['type'] | null> {
  const randomUrls = teamConfig.randomAvatarUrls || [];
  const providers = teamConfig.providers || {};
  const imageCapableProviders = Object.entries(providers).filter(
    ([_, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
  );

  const sourceChoices: Array<{ name: string; value: 'random' | 'generate' | 'custom'; description?: string }> = [];

  if (randomUrls.length > 0) {
    sourceChoices.push({
      name: 'Random (download from URL)',
      value: 'random',
      description: `${randomUrls.length} source${randomUrls.length > 1 ? 's' : ''} available`,
    });
  }

  if (imageCapableProviders.length > 0) {
    sourceChoices.push({
      name: 'AI-generated (image model)',
      value: 'generate',
      description: `${imageCapableProviders.length} provider${imageCapableProviders.length > 1 ? 's' : ''} available`,
    });
  }

  // Always offer custom URL option
  sourceChoices.push({
    name: 'Custom URL (paste any image URL)',
    value: 'custom',
    description: 'Download from any image URL',
  });

  if (sourceChoices.length === 0) {
    return null;
  }

  return select({
    message: 'Avatar source:',
    choices: sourceChoices,
  });
}

/**
 * Prompts user to select a specific random URL when multiple are available
 */
export async function promptForRandomUrl(randomUrls: string[]): Promise<number> {
  if (randomUrls.length === 1) {
    return 0;
  }

  const urlChoices = randomUrls.map((url, index) => {
    // Extract domain for friendly display
    const domainMatch = /https?:\/\/([^/]+)/.exec(url);
    const domain = domainMatch?.[1] || url;
    return {
      name: `${domain} - ${url}`,
      value: index,
    };
  });

  return select({
    message: 'Select random avatar source:',
    choices: urlChoices,
  });
}

/**
 * Prompts user for AI generation configuration (provider, model, prompt)
 */
export async function promptForAiGeneration(
  agent: Agent,
  teamConfig: TeamConfig
): Promise<{ provider: [string, LlmProviderConfig]; modelName: string; prompt: string }> {
  const providers = teamConfig.providers || {};
  const imageCapableProviders = Object.entries(providers).filter(
    ([_, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
  );

  let selectedProvider: [string, LlmProviderConfig];

  if (imageCapableProviders.length > 1) {
    // Let user pick provider
    const providerChoices = imageCapableProviders.map(([name, config]) => ({
      name: `${name} (${Object.keys(config.imageModels!).length} model${Object.keys(config.imageModels!).length > 1 ? 's' : ''})`,
      value: name,
    }));

    const selectedProviderName = await select({
      message: 'Select image generation provider:',
      choices: providerChoices,
    });

    selectedProvider = imageCapableProviders.find(([name]) => name === selectedProviderName)!;
  } else {
    selectedProvider = imageCapableProviders[0];
  }

  // Select model if multiple available
  const imageModels = selectedProvider[1].imageModels!;
  const modelKeys = Object.keys(imageModels);

  let selectedModelName: string;

  if (modelKeys.length > 1) {
    const modelKeyChoices = modelKeys.map(key => ({
      name: `${key}: ${imageModels[key]}`,
      value: key,
    }));

    const selectedKey = await select({
      message: 'Select image model:',
      choices: modelKeyChoices,
    });

    selectedModelName = imageModels[selectedKey];
  } else {
    selectedModelName = imageModels[modelKeys[0]];
  }

  // Generate default prompt
  const defaultPrompt = buildAvatarPrompt(agent);
  console.log(chalk.gray(`\nDefault prompt: ${defaultPrompt}`));

  // Let user edit the prompt
  const promptValue = await input({
    message: 'Avatar generation prompt (press Enter to use default):',
    default: defaultPrompt,
  });

  return {
    provider: selectedProvider,
    modelName: selectedModelName,
    prompt: promptValue,
  };
}

/**
 * Prompts user to enter a custom image URL
 */
export async function promptForCustomUrl(): Promise<string> {
  const rawUrl = await input({
    message: 'Enter image URL:',
    validate: (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length === 0) {
        return 'URL is required';
      }
      try {
        new URL(trimmed);
        return true;
      } catch {
        return 'Please enter a valid URL';
      }
    },
  });
  return rawUrl.trim();
}

/**
 * Generates avatar image based on selected source
 */
export async function generateAvatar(
  source: AvatarSource,
  agent: Agent,
  teamConfig: TeamConfig
): Promise<Buffer> {
  const randomUrls = teamConfig.randomAvatarUrls || [];

  if (source.type === 'random') {
    const urlTemplate = randomUrls[source.urlIndex || 0];
    console.log(chalk.gray(`Downloading from: ${urlTemplate}`));
    return downloadRandomAvatar(urlTemplate, agent);
  } else if (source.type === 'custom') {
    console.log(chalk.gray(`Downloading from: ${source.customUrl}`));
    return downloadRandomAvatar(source.customUrl!, agent);
  } else {
    const [pname, providerConfig] = source.provider!;
    console.log(chalk.gray(`Generating with ${pname}/${source.modelName}`));

    // Get API key
    const apiKeyVar = providerConfig.apiKeyEnvVar || 'OPENAI_API_KEY';
    const apiKey = process.env[apiKeyVar];

    if (!apiKey) {
      throw new Error(
        `API key not found in environment variable: ${apiKeyVar}\n` +
        'Set the API key in .ai-team/.env or your shell environment.'
      );
    }

    return generateAvatarWithAI(
      source.prompt!,
      providerConfig,
      source.modelName!,
      apiKey
    );
  }
}

/**
 * Shows preview and asks for approval, handles retry loop
 */
export async function previewAndApprove(
  agent: Agent,
  source: AvatarSource,
  teamConfig: TeamConfig,
  workspaceRoot: string
): Promise<boolean> {
  let approved = false;

  while (!approved) {
    console.log(chalk.blue('\nGenerating avatar...'));

    try {
      const imageData = await generateAvatar(source, agent, teamConfig);

      // Save preview
      const previewPath = await saveAvatarPreview(agent.id, imageData, workspaceRoot);
      console.log(chalk.green(`✓ Preview saved: ${previewPath}`));

      // Open in default viewer
      console.log(chalk.blue('Opening preview in default viewer...'));
      await openInDefaultViewer(previewPath);

      // Ask for approval
      approved = await confirm({
        message: 'Do you like this avatar?',
        default: true,
      });

      if (!approved) {
        // Clean up and try again
        await cleanupPreview(agent.id, workspaceRoot);
        console.log(chalk.yellow('Let\'s try another one...'));
      }

      return approved;
    } catch (error) {
      console.error(chalk.red(`\n✗ Error generating avatar: ${(error as Error).message}`));
      await cleanupPreview(agent.id, workspaceRoot);

      const retry = await confirm({
        message: 'Try again?',
        default: true,
      });

      if (!retry) {
        return false;
      }
    }
  }

  return approved;
}

/**
 * Finalizes avatar and updates agent
 */
export async function finalizeAndSaveAvatar(
  agent: Agent,
  workspaceRoot: string
): Promise<string> {
  console.log(chalk.blue('\nFinalizing avatar...'));
  const avatarPath = await finalizeAvatar(agent.id, workspaceRoot);
  await updateAgentAvatar(agent, avatarPath, workspaceRoot);

  console.log(chalk.green(`\n✓ Avatar saved for ${agent.name}`));
  console.log(chalk.gray(`  Path: ${avatarPath}`));
  console.log(chalk.gray(`  Agent file updated with avatar reference`));

  return avatarPath;
}

/**
 * Complete interactive avatar selection flow
 */
export async function interactiveAvatarSelection(
  agent: Agent,
  workspaceRoot: string,
  teamConfig: TeamConfig
): Promise<boolean> {
  try {
    // Step 1: Select source
    const sourceType = await promptForAvatarSource(teamConfig);
    if (!sourceType) {
      console.log(chalk.yellow('No avatar sources configured.'));
      return false;
    }

    const source: AvatarSource = { type: sourceType };

    // Step 2: Source-specific setup
    if (sourceType === 'random') {
      const randomUrls = teamConfig.randomAvatarUrls || [];
      source.urlIndex = await promptForRandomUrl(randomUrls);
    } else if (sourceType === 'generate') {
      const aiConfig = await promptForAiGeneration(agent, teamConfig);
      source.provider = aiConfig.provider;
      source.modelName = aiConfig.modelName;
      source.prompt = aiConfig.prompt;
    } else if (sourceType === 'custom') {
      source.customUrl = await promptForCustomUrl();
    }

    // Step 3: Preview loop
    const approved = await previewAndApprove(agent, source, teamConfig, workspaceRoot);
    if (!approved) {
      return false;
    }

    // Step 4: Finalize
    await finalizeAndSaveAvatar(agent, workspaceRoot);
    return true;
  } catch (error) {
    console.error(chalk.red(`\n✗ Error: ${(error as Error).message}`));
    await cleanupPreview(agent.id, workspaceRoot);
    return false;
  }
}

/**
 * Opens a file in the default system viewer
 */
async function openInDefaultViewer(filePath: string): Promise<void> {
  const os = platform();
  let command: string;

  switch (os) {
    case 'win32':
      command = `start "" "${filePath}"`;
      break;
    case 'darwin':
      command = `open "${filePath}"`;
      break;
    default: // linux and others
      command = `xdg-open "${filePath}"`;
      break;
  }

  try {
    await execAsync(command);
  } catch {
    console.warn(chalk.yellow(`\nCould not open preview automatically. Please open manually:\n${filePath}\n`));
  }
}
