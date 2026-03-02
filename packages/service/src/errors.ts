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
    public readonly inputRequest?: ServiceErrorInputRequest,
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

/**
 * Error thrown when an agent query matches multiple agents
 */
export class AmbiguousAgentQueryError extends Error {
  constructor(
    public readonly query: string,
    public readonly matches: Array<{ id: string; name: string; role: string }>,
  ) {
    const matchList = matches.map(m => `  - ${m.name} (${m.role}) [id: ${m.id}]`).join('\n');
    super(`Query "${query}" matches multiple agents:\n${matchList}\nPlease be more specific.`);
    this.name = 'AmbiguousAgentQueryError';
  }
}
