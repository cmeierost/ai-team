import { runUiCommand, type UiCommandOptions } from '@ai-team/service';

export async function uiCommand(options: UiCommandOptions = {}): Promise<void> {
  await runUiCommand(process.cwd(), options);
}
