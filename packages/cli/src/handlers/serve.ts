import { serveApiCommand, type ServeApiOptions } from '@ai-team/service';

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
