export interface CommandOptionMetadata {
  flags: string;
  description: string;
  defaultValue?: string | boolean | string[];
}

export interface CommandArgumentMetadata {
  syntax: string;
  description: string;
}

export interface CliCommandMetadata {
  key: string;
  command: string;
  description: string;
  llmCallable: boolean;
  parentKey?: string;
  options?: CommandOptionMetadata[];
  arguments?: CommandArgumentMetadata[];
}
