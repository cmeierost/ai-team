import fs from 'node:fs/promises';
import path from 'node:path';

function parseEnv(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) vars[key] = value;
  }
  return vars;
}

export async function ensureAiTeamDirectory(workspaceRoot: string): Promise<void> {
  await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
}

export async function loadEnvFile(workspaceRoot: string): Promise<Record<string, string>> {
  try {
    const envPath = path.join(workspaceRoot, '.ai-team', '.env');
    const content = await fs.readFile(envPath, 'utf-8');
    return parseEnv(content);
  } catch {
    return {};
  }
}

export async function loadTeamConfig(workspaceRoot: string): Promise<Record<string, unknown> | undefined> {
  try {
    const configPath = path.join(workspaceRoot, '.ai-team', 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export async function saveAgentAccessPatterns(
  workspaceRoot: string,
  agentId: string,
  patterns: { read?: string[]; write?: string[] }
): Promise<void> {
  const permDir = path.join(workspaceRoot, '.ai-team', 'private', 'permissions');
  await fs.mkdir(permDir, { recursive: true });
  await fs.writeFile(
    path.join(permDir, `${agentId}.json`),
    JSON.stringify({ agentId, ...patterns }, null, 2),
    'utf-8'
  );
}

export async function testLlmConnection(workspaceRoot: string): Promise<{ success: boolean }> {
  const env = await loadEnvFile(workspaceRoot);
  const hasKey = Boolean(Object.values(env).some((value) => value.trim().length > 0));
  if (!hasKey) {
    throw new Error('No LLM API key found in .ai-team/.env.');
  }
  return { success: true };
}
