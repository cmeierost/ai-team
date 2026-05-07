export class PermissionError extends Error {
  constructor(agentId: string, filePath: string) {
    super(`Agent ${agentId} does not have permission to access ${filePath}`);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

export class AmbiguousAgentQueryError extends Error {
  constructor(
    public readonly query: string,
    public readonly matches: Array<{ id: string; name: string; role: string }>
  ) {
    const matchList = matches.map((m) => `  - ${m.name} (${m.role}) [id: ${m.id}]`).join('\n');
    super(`Query "${query}" matches multiple agents:\n${matchList}\nPlease be more specific.`);
    this.name = 'AmbiguousAgentQueryError';
  }
}
