import fs from 'node:fs/promises';
import path from 'node:path';
import {
  saveAgentAccessPatterns,
  LlmService,
  AgentManager,
  buildAgentMarkdown,
  ContextLevel,
  RoleType,
} from '@ai-team/infrastructure';
import type { Agent, ChatMessage } from '@ai-team/infrastructure';
import { getPersonalityForHire } from './hire.js';
import type { InitOptions } from '@ai-team/api-client';
import { getGitUserName } from '../utils/git.js';
import { SessionManager } from '../session-manager.js';
import { createSqliteStorage } from '../storage/index.js';
import {
  createRoleTemplates,
  createBootstrapWorkspaceFiles,
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
} from './init/bootstrap-files.js';
import {
  INIT_TEMPLATE_FILE_MAP,
  type InitTemplateKey,
  getWorkspaceTemplatePath,
  readDefaultTemplate,
  loadInitTemplates,
  renderTemplate,
  parseTemplateBulletList,
} from './init/template-utils.js';
import {
  type InitRuntimeHooks,
  requestInput,
  requestConfirm,
  requestSelect,
} from './init/workflow-questions.js';
import { pickAgentName } from './init/name-picking.js';
import { createAgentFile } from './init/agent-file.js';
import { saveOnboardingTranscriptAsync } from './init/onboarding-docs.js';
import { runInitWorkflowAsync } from './init-workflow.js';
import {
  loadOnboardingWorkflowDefinitionFromTemplates,
  getOnboardingPhase,
  type OnboardingWorkflowPhase,
} from './init/onboarding-workflow-definition.js';

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

function writeWarn(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'warn', message });
  if (!hooks?.emit) {
    process.stdout.write(`${message}\n`);
  }
}

const FORCE_KEEP = new Set(['config.json', '.env']);

async function clearAiTeamDirectory(workspaceRoot: string, hooks?: InitRuntimeHooks) {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(aiTeamDir, { withFileTypes: true });
  } catch {
    return; // directory doesn't exist yet
  }

  for (const entry of entries) {
    if (FORCE_KEEP.has(entry.name)) continue;
    const target = path.join(aiTeamDir, entry.name);
    try {
      await fs.rm(target, { recursive: true, force: true });
      writeLine(hooks, `  Removed: ${entry.name}`);
    } catch (err) {
      writeWarn(
        hooks,
        `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export async function initCommand(
  workspaceRoot: string,
  options: InitOptions,
  hooks?: InitRuntimeHooks
) {
  await runInitWorkflowAsync(workspaceRoot, options, hooks, {
    writeLine,
    writeWarn,
    clearAiTeamDirectory,
  });
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

export async function runOnboarding(
  workspaceRoot: string,
  llm: LlmService,
  hooks?: InitRuntimeHooks
) {
  writeLine(hooks, '');
  writeLine(hooks, '--- Team Onboarding ---');
  writeLine(hooks, "Let's set up your founding team.");

  await createBootstrapTemplateFiles(workspaceRoot, {
    templateKeys: Object.keys(INIT_TEMPLATE_FILE_MAP) as InitTemplateKey[],
    readDefaultTemplate,
    getWorkspaceTemplatePath,
    writeFileIfMissing,
  });
  const templates = await loadInitTemplates(workspaceRoot);

  await createBootstrapWorkspaceFiles(workspaceRoot, templates, writeFileIfMissing);
  await createBootstrapInstructions(workspaceRoot, templates, writeFileIfMissing);
  await createBootstrapSkills(workspaceRoot, templates);
  await createRoleTemplates(workspaceRoot, templates);

  writeLine(hooks, "First, let's name your founding team.");

  const ceoName = await pickAgentName(llm, templates, 'CEO', [], hooks, {
    requestSelect,
    requestInput,
    writeWarn,
  });
  writeLine(hooks, `CEO: My name is ${ceoName}.`);

  const hrName = await pickAgentName(llm, templates, 'Head of Human Resources', [ceoName], hooks, {
    requestSelect,
    requestInput,
    writeWarn,
  });
  writeLine(hooks, `CEO: I need an HR Director to build the team. Let's call them ${hrName}.`);
  writeLine(hooks, `  HR Director: ${hrName}`);

  writeLine(hooks, '--- Creating Founding Team ---');

  const ceoAgent = await createAgentFile(workspaceRoot, {
    name: ceoName,
    role: 'ceo',
    type: 'executive',
    contextLevel: 'organization',
    personality: {
      communication_style: 'strategic',
      expertise_level: 'executive',
      mentoring: true,
    },
    introduction: renderTemplate(templates.ceoAgentIntroduction, { ceoName, hrName }).trim(),
    personalityProfile: parseTemplateBulletList(templates.ceoAgentPersonality),
  });
  writeLine(hooks, `  ${ceoName} has joined as CEO`);

  const hrAgent = await createAgentFile(workspaceRoot, {
    name: hrName,
    role: 'hr-director',
    type: 'executive',
    contextLevel: 'organization',
    reportsTo: 'ceo',
    personality: {
      communication_style: 'supportive',
      expertise_level: 'executive',
      mentoring: true,
    },
    introduction: renderTemplate(templates.hrAgentIntroduction, { ceoName, hrName }).trim(),
    personalityProfile: parseTemplateBulletList(templates.hrAgentPersonality),
  });
  writeLine(hooks, `  ${hrName} has joined as HR Director`);

  await saveAgentAccessPatterns(workspaceRoot, ceoAgent.id, {
    list: ['**/*'],
    read: ['**/*'],
    write: ['.ai-team/**/*', '.github/copilot-instructions.md', 'AGENTS.md', 'docs/**/*'],
  });

  await saveAgentAccessPatterns(workspaceRoot, hrAgent.id, {
    list: ['**/*'],
    read: ['**/*'],
    write: [
      '.ai-team/**/*',
      '.ai-team/skills-catalog/**/*',
      '.github/skills/**/*',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'docs/**/*',
    ],
  });

  const developerName = getGitUserName();
  const onboardingWorkflow = loadOnboardingWorkflowDefinitionFromTemplates({
    templates,
    ceoName,
    hrName,
    developerName,
  });

  const businessPhase = getOnboardingPhase(onboardingWorkflow, 'business-definition');
  const businessAgent = resolveOnboardingPhaseAgent(businessPhase, ceoAgent, hrAgent);

  writeLine(hooks, `--- ${businessPhase.heading} ---`);
  for (const line of businessPhase.introLines) {
    writeLine(hooks, line);
  }

  const businessContext = await runWorkflowChatPhase(
    workspaceRoot,
    businessAgent,
    developerName,
    businessPhase,
    hooks
  );

  if (businessContext.length > 0) {
    await saveOnboardingPhaseTranscript(
      workspaceRoot,
      businessContext,
      businessAgent,
      developerName,
      businessPhase
    );
    writeLine(hooks, `Transcript saved to ${businessPhase.transcript.relativePath}`);
  }

  const planningPhase = getOnboardingPhase(onboardingWorkflow, 'team-planning');
  const planningAgent = resolveOnboardingPhaseAgent(planningPhase, ceoAgent, hrAgent);

  writeLine(hooks, `--- ${planningPhase.heading} ---`);
  for (const line of planningPhase.introLines) {
    writeLine(hooks, line);
  }

  const hrHistory = await runWorkflowChatPhase(
    workspaceRoot,
    planningAgent,
    developerName,
    planningPhase,
    hooks
  );

  if (hrHistory.length > 0) {
    await saveOnboardingPhaseTranscript(
      workspaceRoot,
      hrHistory,
      planningAgent,
      developerName,
      planningPhase
    );
    writeLine(hooks, `Transcript saved to ${planningPhase.transcript.relativePath}`);
  }

  // Parse HIRE: directives from HR conversation and execute them
  const hireDirectives = parseHireDirectives(hrHistory);
  if (hireDirectives.length > 0) {
    writeLine(hooks, '');
    writeLine(hooks, '--- Hiring Team ---');
    const hiredAgents = await executeOnboardingHires(
      workspaceRoot,
      hireDirectives,
      ceoAgent.id,
      hooks
    );
    writeLine(hooks, '');
    if (hiredAgents.length > 0) {
      writeLine(hooks, `✓ ${hiredAgents.length} agent(s) hired and ready.`);
    }
  } else {
    writeLine(hooks, '');
    writeLine(
      hooks,
      'No HIRE: directives found in HR conversation. You can hire agents later with `ait hire` or by chatting with your HR director.'
    );
  }

  const handoffSummary =
    hireDirectives.length > 0
      ? `Hiring wave completed with ${hireDirectives.length} proposed role(s). Team planning notes are saved in ${planningPhase.transcript.relativePath}.`
      : 'Initial onboarding and team planning are complete. No hires were executed yet.';

  writeLine(hooks, '');
  writeLine(hooks, `${hrName} (hr-director): HANDOFF: ${ceoName} | ${handoffSummary}`);

  writeLine(hooks, '');
  writeLine(hooks, '--- Onboarding Complete ---');
  writeLine(
    hooks,
    `Handing off to ${ceoAgent.name} (ceo) for execution planning in the normal chat flow...`
  );
  writeLine(hooks, '');

  // Import chatCommand lazily to avoid circular dependency issues
  const { chatCommand: startChat } = await import('./chat/index.js');
  await startChat(
    workspaceRoot,
    ceoAgent.id,
    {
      pendingIntroduction: `${hrName} handed off to ${ceoName}. ${handoffSummary}`,
    },
    {
      signal: hooks?.signal,
      emit: hooks?.emit,
      questionInput: hooks?.questionInput,
      questionConfirm: hooks?.questionConfirm,
      questionSelect: hooks?.questionSelect,
      questionPassword: hooks?.questionPassword,
      questionChecklist: hooks?.questionChecklist,
    }
  );
}

// ── HIRE: directive parsing ──────────────────────────────────────────────────

const HIRE_DIRECTIVE_RE = /^HIRE:\s*(.+?)\s*\|\s*(.+?)\s*$/gm;

interface HireDirective {
  name: string;
  role: string;
}

function parseHireDirectives(history: ChatMessage[]): HireDirective[] {
  const hires: HireDirective[] = [];
  const seen = new Set<string>();
  for (const msg of history) {
    if (msg.isHuman) continue;
    for (const match of msg.content.matchAll(HIRE_DIRECTIVE_RE)) {
      const name = match[1].trim();
      const role = match[2].trim();
      const key = `${name.toLowerCase()}|${role.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        hires.push({ name, role });
      }
    }
  }
  return hires;
}

function inferRoleType(role: string): RoleType {
  const r = role.toLowerCase();
  if (/ceo|cto|cfo|coo|chief|vp|director/.test(r)) return RoleType.EXECUTIVE;
  if (/lead|head|manager|principal/.test(r)) return RoleType.TEAM_LEAD;
  return RoleType.INDIVIDUAL_CONTRIBUTOR;
}

async function executeOnboardingHires(
  workspaceRoot: string,
  hires: HireDirective[],
  ceoAgentId: string,
  hooks?: InitRuntimeHooks
): Promise<Agent[]> {
  if (hires.length === 0) return [];

  const agentManager = new AgentManager(workspaceRoot);

  const hiredAgents: Agent[] = [];
  for (const [index, hire] of hires.entries()) {
    const shouldHire = await requestConfirm(hooks, {
      message: `Hire now (${index + 1}/${hires.length}): ${hire.name} as ${hire.role}?`,
      default: true,
    });

    if (!shouldHire) {
      writeLine(hooks, `  - Skipped ${hire.name} (${hire.role})`);
      continue;
    }

    const roleType = inferRoleType(hire.role);
    const preset = getPersonalityForHire(hire.role, roleType);

    // Chief architect reports to CEO; others report to chief-architect if one exists
    let reportsTo: string | undefined;
    if (/architect|cto/.test(hire.role.toLowerCase())) {
      reportsTo = ceoAgentId;
    } else {
      const architect = hiredAgents.find((a) => /architect|cto/.test(a.role));
      reportsTo = architect?.id ?? ceoAgentId;
    }

    const markdown = buildAgentMarkdown({
      personalityProfile: preset.profile,
    });

    try {
      const agent = await agentManager.createAgentAsync(
        {
          name: hire.name,
          role: hire.role,
          type: roleType,
          contextLevel:
            roleType === RoleType.EXECUTIVE ? ContextLevel.ORGANIZATION : ContextLevel.MODULE,
          reportsTo,
          personality: {
            communication_style: preset.communication_style,
            expertise_level: preset.expertise_level,
            mentoring: preset.mentoring,
          },
        },
        { markdown }
      );

      // Set up access: read all, write under .ai-team and docs
      await saveAgentAccessPatterns(workspaceRoot, agent.id, {
        list: ['**/*'],
        read: ['**/*'],
        write: ['.ai-team/**/*', 'docs/**/*'],
      });

      hiredAgents.push(agent);
      writeLine(hooks, `  ✓ Hired ${agent.name} as ${agent.role} (reports to ${reportsTo})`);
    } catch (err) {
      writeWarn(
        hooks,
        `  ✗ Could not hire ${hire.name} as ${hire.role}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return hiredAgents;
}

function resolveOnboardingPhaseAgent(
  phase: OnboardingWorkflowPhase,
  ceoAgent: Agent,
  hrAgent: Agent
): Agent {
  if (phase.agentRole === 'ceo') {
    return ceoAgent;
  }

  return hrAgent;
}

function buildStrictWorkflowPrompt(phase: OnboardingWorkflowPhase): string {
  return [
    phase.strictSystemPrompt.trim(),
    '',
    '## Workflow goal (strict)',
    phase.goal,
    '',
    '## Runtime contract',
    '- Stay in role and keep this phase focused on its goal.',
    '- If the developer indicates completion, give a concise recap and let them continue.',
    '- Keep responses concise and decision-oriented by default.',
  ]
    .join('\n')
    .trim();
}

async function runWorkflowChatPhase(
  workspaceRoot: string,
  agent: Agent,
  developerName: string | undefined,
  phase: OnboardingWorkflowPhase,
  hooks?: InitRuntimeHooks
): Promise<ChatMessage[]> {
  const { chatCommand: startChat } = await import('./chat/index.js');
  await startChat(
    workspaceRoot,
    agent.id,
    {
      createNewSession: true,
      workflowMode: true,
      workflowSystemPrompt: buildStrictWorkflowPrompt(phase),
      workflowExitWords: phase.exitWords,
      suppressAutoIntroduction: phase.suppressAutoIntroduction,
      disableProcessExit: true,
      pendingIntroduction: developerName
        ? `Workflow phase started: ${phase.heading}. Developer: ${developerName}.`
        : `Workflow phase started: ${phase.heading}.`,
    },
    {
      signal: hooks?.signal,
      emit: hooks?.emit,
      questionInput: hooks?.questionInput,
      questionConfirm: hooks?.questionConfirm,
      questionSelect: hooks?.questionSelect,
      questionPassword: hooks?.questionPassword,
      questionChecklist: hooks?.questionChecklist,
    }
  );

  const sessionManager = new SessionManager(
    workspaceRoot,
    createSqliteStorage(workspaceRoot),
    new AgentManager(workspaceRoot)
  );

  try {
    const latestSession = await sessionManager.getLatestSession(agent.id);
    if (!latestSession) {
      return [];
    }

    const history = await sessionManager.getSessionMessages(latestSession.id);
    return history;
  } finally {
    await sessionManager.close();
  }
}

async function saveOnboardingPhaseTranscript(
  workspaceRoot: string,
  history: ChatMessage[],
  agent: Agent,
  developerName: string | undefined,
  phase: OnboardingWorkflowPhase
) {
  await saveOnboardingTranscriptAsync({
    workspaceRoot,
    relativePath: phase.transcript.relativePath,
    title: phase.transcript.title,
    intro: phase.transcript.intro,
    history,
    developerLabel: developerName,
    agentLabel: `${agent.name} (${agent.role})`,
  });
}
