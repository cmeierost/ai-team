import fs from 'node:fs/promises';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function ensureLocationSetting(settings: JsonObject, key: string, location: string): void {
  const current = asObject(settings[key]);
  settings[key] = {
    ...current,
    [location]: true,
  };
}

export async function updateWorkspaceSettings(workspaceRoot: string): Promise<void> {
  const vscodeDir = path.join(workspaceRoot, '.vscode');
  const settingsPath = path.join(vscodeDir, 'settings.json');

  let settings: JsonObject = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = asObject(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`Failed to parse existing .vscode/settings.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  ensureLocationSetting(settings, 'chat.promptFilesLocations', '.ai-team/prompts');
  ensureLocationSetting(settings, 'chat.instructionsFilesLocations', '.ai-team/instructions');
  ensureLocationSetting(settings, 'chat.hookFilesLocations', '.ai-team/hooks');
  ensureLocationSetting(settings, 'chat.agentFilesLocations', '.ai-team/agents');
  ensureLocationSetting(settings, 'chat.agentSkillsLocations', '.ai-team/skills');

  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 4) + '\n', 'utf-8');
}
