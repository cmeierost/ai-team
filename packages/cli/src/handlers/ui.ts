import { runUiCommand, type UiCommandOptions } from '@ai-team/service';

export async function launchUi(
  options: UiCommandOptions = {},
  workspaceRoot?: string
): Promise<void> {
  await runUiCommand(workspaceRoot || process.cwd(), options);
}
