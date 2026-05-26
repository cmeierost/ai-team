import fs from 'node:fs/promises';
import path from 'node:path';

export interface InitBootstrapTemplates {
  roleCeoFile: string;
  roleHrDirectorFile: string;
  roleChiefArchitectFile: string;
  docsArchitectureOverviewFile: string;
  docsArchitectureDiagramsFile: string;
  docsRequirementsTraceabilityFile: string;
  docsApiContractsFile: string;
  aiTeamReadmeFile: string;
  bootstrapAgentsFile: string;
  bootstrapCopilotInstructionsFile: string;
  bootstrapAiTeamWayFile: string;
  instructionsAgentsFile: string;
  instructionsAgentMetadataFile: string;
  instructionsSkillsFile: string;
  instructionsPromptsFile: string;
  skillAgentAuthoringFile: string;
}

export interface BootstrapTemplateSeedContext<K extends string> {
  templateKeys: readonly K[];
  readDefaultTemplate: (key: K) => Promise<string>;
  getWorkspaceTemplatePath: (workspaceRoot: string, key: K) => string;
  writeFileIfMissing: (filePath: string, content: string) => Promise<void>;
}

export async function createRoleTemplates(workspaceRoot: string, templates: InitBootstrapTemplates): Promise<void> {
  const rolesDir = path.join(workspaceRoot, '.ai-team', 'roles');
  await fs.mkdir(rolesDir, { recursive: true });
  await fs.writeFile(path.join(rolesDir, 'cto.md'), templates.roleCeoFile, 'utf-8');
  await fs.writeFile(path.join(rolesDir, 'hr-director.md'), templates.roleHrDirectorFile, 'utf-8');
  await fs.writeFile(path.join(rolesDir, 'chief-architect.md'), templates.roleChiefArchitectFile, 'utf-8');

  const architectureDir = path.join(workspaceRoot, 'docs', 'architecture');
  const apiDir = path.join(workspaceRoot, 'docs', 'api');
  await fs.mkdir(architectureDir, { recursive: true });
  await fs.mkdir(apiDir, { recursive: true });

  await fs.writeFile(path.join(architectureDir, 'overview.md'), templates.docsArchitectureOverviewFile, 'utf-8');
  await fs.writeFile(path.join(architectureDir, 'diagrams.md'), templates.docsArchitectureDiagramsFile, 'utf-8');
  await fs.writeFile(path.join(architectureDir, 'requirements-traceability.md'), templates.docsRequirementsTraceabilityFile, 'utf-8');
  await fs.writeFile(path.join(apiDir, 'contracts.md'), templates.docsApiContractsFile, 'utf-8');
  await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'README.md'), templates.aiTeamReadmeFile, 'utf-8');
}

export async function createBootstrapWorkspaceFiles(
  workspaceRoot: string,
  templates: InitBootstrapTemplates,
  writeFileIfMissing: (filePath: string, content: string) => Promise<void>,
): Promise<void> {
  await writeFileIfMissing(path.join(workspaceRoot, 'AGENTS.md'), templates.bootstrapAgentsFile);
  await writeFileIfMissing(path.join(workspaceRoot, '.github', 'copilot-instructions.md'), templates.bootstrapCopilotInstructionsFile);
  await writeFileIfMissing(path.join(workspaceRoot, '.ai-team', 'ai-team-way.md'), templates.bootstrapAiTeamWayFile);
}

export async function createBootstrapInstructions(
  workspaceRoot: string,
  templates: InitBootstrapTemplates,
  writeFileIfMissing: (filePath: string, content: string) => Promise<void>,
): Promise<void> {
  const instructionsDir = path.join(workspaceRoot, '.ai-team', 'instructions');

  await writeFileIfMissing(path.join(instructionsDir, 'agents.instructions.md'), templates.instructionsAgentsFile);
  await writeFileIfMissing(path.join(instructionsDir, 'agent-metadata.instructions.md'), templates.instructionsAgentMetadataFile);
  await writeFileIfMissing(path.join(instructionsDir, 'skills.instructions.md'), templates.instructionsSkillsFile);
  await writeFileIfMissing(path.join(instructionsDir, 'prompts.instructions.md'), templates.instructionsPromptsFile);
}

export async function createBootstrapSkills(workspaceRoot: string, templates: InitBootstrapTemplates): Promise<void> {
  const skillsDir = path.join(workspaceRoot, '.ai-team', 'skills');
  const agentAuthoringDir = path.join(skillsDir, 'agent-authoring');

  await fs.mkdir(agentAuthoringDir, { recursive: true });
  await fs.writeFile(path.join(agentAuthoringDir, 'SKILL.md'), templates.skillAgentAuthoringFile, 'utf-8');
}

export async function createBootstrapTemplateFiles<K extends string>(
  workspaceRoot: string,
  context: BootstrapTemplateSeedContext<K>,
): Promise<void> {
  for (const key of context.templateKeys) {
    const content = await context.readDefaultTemplate(key);
    const targetPath = context.getWorkspaceTemplatePath(workspaceRoot, key);
    await context.writeFileIfMissing(targetPath, content);
  }
}
