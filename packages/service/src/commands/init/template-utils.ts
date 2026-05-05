import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INIT_TEMPLATE_RELATIVE_DIR = path.join('.ai-team', 'templates', 'init');

export const INIT_TEMPLATE_FILE_MAP = {
  nameSystemPrompt: 'name-system.template.md',
  nameRequestPrompt: 'name-request.template.md',
  nameRequestStrictPrompt: 'name-request-strict.template.md',
  ceoAgentIntroduction: 'ceo-agent-introduction.template.md',
  ceoAgentPersonality: 'ceo-agent-personality.template.md',
  hrAgentIntroduction: 'hr-agent-introduction.template.md',
  hrAgentPersonality: 'hr-agent-personality.template.md',
  onboardingCeoSystemPrompt: 'onboarding-ceo-system.template.md',
  onboardingHrSystemPrompt: 'onboarding-hr-system.template.md',
  onboardingWorkflowDefinition: 'onboarding-workflow.template.yaml',
  bootstrapAgentsFile: 'bootstrap-agents.template.md',
  bootstrapCopilotInstructionsFile: 'bootstrap-copilot-instructions.template.md',
  bootstrapAiTeamWayFile: 'bootstrap-ai-team-way.template.md',
  instructionsAgentsFile: 'instructions-agents.template.md',
  instructionsAgentMetadataFile: 'instructions-agent-metadata.template.md',
  instructionsSkillsFile: 'instructions-skills.template.md',
  instructionsPromptsFile: 'instructions-prompts.template.md',
  skillAgentAuthoringFile: 'skill-agent-authoring.template.md',
  roleCeoFile: 'role-ceo.template.md',
  roleHrDirectorFile: 'role-hr-director.template.md',
  roleChiefArchitectFile: 'role-chief-architect.template.md',
  docsArchitectureOverviewFile: 'docs-architecture-overview.template.md',
  docsArchitectureDiagramsFile: 'docs-architecture-diagrams.template.md',
  docsRequirementsTraceabilityFile: 'docs-requirements-traceability.template.md',
  docsApiContractsFile: 'docs-api-contracts.template.md',
  aiTeamReadmeFile: 'ai-team-readme.template.md',
} as const;

export type InitTemplateKey = keyof typeof INIT_TEMPLATE_FILE_MAP;

export type InitTemplates = Record<InitTemplateKey, string>;

const TEMPLATE_BODY_ONLY_KEYS = new Set<InitTemplateKey>([
  'nameSystemPrompt',
  'nameRequestPrompt',
  'nameRequestStrictPrompt',
  'ceoAgentIntroduction',
  'ceoAgentPersonality',
  'hrAgentIntroduction',
  'hrAgentPersonality',
  'onboardingCeoSystemPrompt',
  'onboardingHrSystemPrompt',
]);

let cachedDefaultTemplateDirectory: Promise<string> | undefined;

export function getWorkspaceTemplatePath(workspaceRoot: string, key: InitTemplateKey): string {
  return path.join(workspaceRoot, INIT_TEMPLATE_RELATIVE_DIR, INIT_TEMPLATE_FILE_MAP[key]);
}

async function resolveDefaultTemplateDirectory(): Promise<string> {
  cachedDefaultTemplateDirectory ??= (async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(currentDir, '../init-templates'),
      path.join(currentDir, '../../../src/commands/init-templates'),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }

    throw new Error('Could not locate init template directory.');
  })();

  return cachedDefaultTemplateDirectory;
}

export async function readDefaultTemplate(key: InitTemplateKey): Promise<string> {
  const defaultTemplateDirectory = await resolveDefaultTemplateDirectory();
  const templatePath = path.join(defaultTemplateDirectory, INIT_TEMPLATE_FILE_MAP[key]);
  return fs.readFile(templatePath, 'utf-8');
}

async function readInitTemplate(workspaceRoot: string, key: InitTemplateKey): Promise<string> {
  const workspaceTemplatePath = getWorkspaceTemplatePath(workspaceRoot, key);
  try {
    return await fs.readFile(workspaceTemplatePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  return readDefaultTemplate(key);
}

export async function loadInitTemplates(workspaceRoot: string): Promise<InitTemplates> {
  const entries = await Promise.all(
    (Object.keys(INIT_TEMPLATE_FILE_MAP) as InitTemplateKey[]).map(async (key) => {
      const rawTemplate = await readInitTemplate(workspaceRoot, key);
      const normalizedTemplate = TEMPLATE_BODY_ONLY_KEYS.has(key)
        ? extractTemplateBody(rawTemplate)
        : rawTemplate;
      return [key, normalizedTemplate] as const;
    })
  );

  return Object.fromEntries(entries) as InitTemplates;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replaceAll(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_match, token: string) => values[token] ?? ''
  );
}

export function extractTemplateBody(template: string): string {
  const lines = template.split(/\r?\n/);
  if (lines[0]?.trim().startsWith('# ')) {
    const bodyLines = lines.slice(1);
    if (bodyLines[0]?.trim() === '') {
      bodyLines.shift();
    }
    return bodyLines.join('\n').trim();
  }
  return template.trim();
}

export function parseTemplateBulletList(template: string): string[] {
  return template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line.slice(2).trim() : line))
    .filter(Boolean);
}
