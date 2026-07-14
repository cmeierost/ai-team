import { runUiCommand, type UiCommandOptions } from './ui-command.js';

export async function launchUi(
  options: UiCommandOptions = {},
  workspaceRoot?: string
): Promise<void> {
  await runUiCommand(workspaceRoot || process.cwd(), options);
}
