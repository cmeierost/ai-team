import type { IServiceContainer } from '@ai-team/core';

let container: IServiceContainer | undefined;

export function setServiceContainer(next: IServiceContainer): void {
  container = next;
}

export function getServiceContainer(): IServiceContainer {
  if (!container) {
    throw new Error('Service container has not been initialized.');
  }
  return container;
}

export function tryGetServiceContainer(): IServiceContainer | undefined {
  return container;
}
