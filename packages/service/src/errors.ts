import { AmbiguousAgentQueryError as CoreAmbiguousAgentQueryError } from '@ai-team/core';

export type ServiceErrorCode =
  | 'INPUT_REQUIRED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export interface ServiceErrorInputRequest {
  kind: 'env-var';
  key: string;
  prompt: string;
}

export class ServiceDomainError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly inputRequest?: ServiceErrorInputRequest
  ) {
    super(message);
    this.name = 'ServiceDomainError';
  }
}

export function toServiceDomainError(error: unknown, fallbackMessage: string): ServiceDomainError {
  if (error instanceof ServiceDomainError) {
    return error;
  }

  if (error instanceof Error) {
    return new ServiceDomainError('INTERNAL', error.message || fallbackMessage);
  }

  return new ServiceDomainError('INTERNAL', fallbackMessage);
}

export const AmbiguousAgentQueryError = CoreAmbiguousAgentQueryError;
