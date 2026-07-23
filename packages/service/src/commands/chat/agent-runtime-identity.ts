import type {
  Agent,
  IConfigurationStorage,
  ILlmSettingsResolver,
} from '@ai-team/core';

/**
 * Adds the effective provider/model identity used by runtime presentation
 * events without mutating the AgentManager's cached document model.
 */
export class AgentRuntimeIdentityResolver {
  constructor(
    private readonly configurationStorage: Pick<IConfigurationStorage, 'get'>,
    private readonly llmSettingsResolver: Pick<
      ILlmSettingsResolver,
      'resolveEffectiveLlmSettings'
    >
  ) {}

  resolve(agent: Agent): Agent {
    try {
      const resolved = this.llmSettingsResolver.resolveEffectiveLlmSettings(
        this.configurationStorage.get(),
        agent
      );
      const hasExplicitProfile = Boolean(
        agent.llm?.provider || agent.llm?.modelKey
      );
      return {
        ...agent,
        resolvedLlm: {
          providerRef: resolved.providerRef,
          model: resolved.config.model,
          contextWindow: resolved.contextWindow,
          isDefault: !hasExplicitProfile,
        },
      };
    } catch {
      return agent;
    }
  }
}
