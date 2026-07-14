import { serveApiCommand, type ServeApiOptions } from './serve-command.js';

export async function launchServer(
  options: ServeApiOptions = {},
  workspaceRoot?: string
): Promise<void> {
  await serveApiCommand(workspaceRoot || process.cwd(), options);
}

export async function launchServerWithUi(
  options: ServeApiOptions = {},
  workspaceRoot?: string
): Promise<void> {
  await serveApiCommand(workspaceRoot || process.cwd(), { ...options, ui: true });
}
