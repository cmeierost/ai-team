import { ServiceContainer, type MergeTokenSets, type TokenSet } from './container.js';

export type ContainerBootstrapper<TConfig, TServices extends Record<string, unknown> = {}> = (
  container: ServiceContainer<TServices>,
  config: TConfig
) => void;

export function createBootstrappedContainer<TConfig, const TSets extends readonly TokenSet[] = []>(
  config: TConfig,
  bootstrap: ContainerBootstrapper<TConfig, MergeTokenSets<TSets>>,
  ..._tokenSets: TSets
): ServiceContainer<MergeTokenSets<TSets>> {
  const container = new ServiceContainer<MergeTokenSets<TSets>>();
  bootstrap(container, config);
  return container;
}
