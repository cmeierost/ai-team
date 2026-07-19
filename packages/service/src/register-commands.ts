import type { IServiceContainerRegistrar } from '@ai-team/core';
import {
  registerServiceLayerServices,
  type ServiceLayerRegistrationConfig,
} from './register-services.js';

/**
 * High-level service bootstrap for command-enabled runtimes.
 *
 * Command registration depends on all service registrations, so this entrypoint
 * delegates to registerServiceLayerServices.
 */
export function registerCommands(
  container: IServiceContainerRegistrar,
  cfg: ServiceLayerRegistrationConfig
): void {
  registerServiceLayerServices(container, cfg);
}
