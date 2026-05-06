/**
 * Onboard command — CEO + HR Director creation, business definition, team hiring.
 *
 * Requires LLM to be configured (via `setup` command first).
 * Creates the founding team, runs the business definition chat with the CEO,
 * then the team planning chat with the HR Director, and finally drops
 * into interactive CEO chat.
 */

import type {
  IAgentManager,
  IConfigurationStorage,
  IEnvironmentStorage,
  IPermissionStorage,
  ILlmService,
  IAgentDocumentStorage,
  Agent,
  ChatMessage,
} from '@ai-team/core';
import { ContextLevel, RoleType, resolveEffectiveLlmSettings } from '@ai-team/core';
import type { OnboardOptions } from '@ai-team/api-contracts';
import { SessionManager } from '../session-manager.js';
import type { CommandExecute } from './command-contract.js';
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
import {
  loadOnboardingWorkflowDefinitionFromTemplates,
  getOnboardingPhase,
  type OnboardingWorkflowPhase,
} from './init/onboarding-workflow-definition.js';
import { getPersonalityForHire } from './hire.js';
import { getGitUserName } from '../utils/git.js';

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

function resolveOnboardingPhaseAgent(
  phase: OnboardingWorkflowPhase,
  ceoAgent: Agent,
  hrAgent: Agent
): Agent {
  return phase.agentRole === 'ceo' ? ceoAgent : hrAgent;
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

// ── OnboardCommand ────────────────────────────────────────────────────────────

export interface OnboardCommandParams {
  options?: OnboardOptions;
  injected?: { sessionManager?: SessionManager };
}

export class OnboardCommand implements CommandExecute<
  OnboardCommandParams,
  InitRuntimeHooks | undefined,
  void
> {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly permissionStorage: IPermissionStorage,
    private readonly agentDocumentStorage: IAgentDocumentStorage
  ) {}

  async execute(params: OnboardCommandParams = {}, hooks?: InitRuntimeHooks): Promise<void> {
    const { injected } = params;
    const workspaceRoot = this.agentManager.workspaceRoot;

    const teamConfig = await this.configurationStorage.loadTeamConfigAsync(workspaceRoot);
    if (!teamConfig) {
      throw new Error(
        'LLM is not configured. Run `ait setup` first to configure your LLM provider.'
      );
    }

    let resolvedLlm: ReturnType<typeof resolveEffectiveLlmSettings>;
    try {
      resolvedLlm = resolveEffectiveLlmSettings(teamConfig);
    } catch {
      throw new Error(
        'LLM configuration is incomplete. Run `ait setup` to reconfigure your provider.'
      );
    }

    let apiKey: string | undefined;
    if (resolvedLlm.apiKeyEnvVar) {
      const envVars = await this.environmentStorage.loadEnvFileAsync(workspaceRoot);
      apiKey = envVars[resolvedLlm.apiKeyEnvVar] || envVars['AI_TEAM_LLM_API_KEY'];
    }

    const { LlmService } = await import('@ai-team/infrastructure');
    const llm = new LlmService(workspaceRoot, this.configurationStorage, this.environmentStorage);
    llm.initializeFromConfig(resolvedLlm.config, apiKey);

    this.writeLine(hooks, '');
    this.writeLine(hooks, 'Starting team onboarding...');

    await this.runOnboardingAsync(llm as unknown as ILlmService, hooks, injected);
  }

  private writeLine(hooks: InitRuntimeHooks | undefined, message: string): void {
    hooks?.emit?.({ kind: 'log', level: 'info', message });
    if (!hooks?.emit) process.stdout.write(`${message}\n`);
  }

  private writeWarn(hooks: InitRuntimeHooks | undefined, message: string): void {
    hooks?.emit?.({ kind: 'log', level: 'warn', message });
    if (!hooks?.emit) process.stdout.write(`${message}\n`);
  }

  private async writeFileIfMissingAsync(filePath: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      await fs.access(filePath);
    } catch {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
    }
  }

  private async runOnboardingAsync(
    llm: ILlmService,
    hooks?: InitRuntimeHooks,
    injected?: { sessionManager?: SessionManager }
  ): Promise<void> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const writeFileIfMissing = this.writeFileIfMissingAsync.bind(this);

    this.writeLine(hooks, '');
    this.writeLine(hooks, '--- Team Onboarding ---');
    this.writeLine(hooks, "Let's set up your founding team.");

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

    this.writeLine(hooks, "First, let's name your founding team.");

    const ceoName = await pickAgentName(llm, templates, 'CEO', [], hooks, {
      requestSelect,
      requestInput,
      writeWarn: (h, m) => this.writeWarn(h, m),
    });
    this.writeLine(hooks, `CEO: My name is ${ceoName}.`);

    const hrName = await pickAgentName(
      llm,
      templates,
      'Head of Human Resources',
      [ceoName],
      hooks,
      { requestSelect, requestInput, writeWarn: (h, m) => this.writeWarn(h, m) }
    );
    this.writeLine(
      hooks,
      `CEO: I need an HR Director to build the team. Let's call them ${hrName}.`
    );
    this.writeLine(hooks, `  HR Director: ${hrName}`);

    this.writeLine(hooks, '--- Creating Founding Team ---');

    const ceoAgent = await createAgentFile(
      workspaceRoot,
      {
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
      },
      this.agentDocumentStorage
    );
    this.writeLine(hooks, `  ${ceoName} has joined as CEO`);

    const hrAgent = await createAgentFile(
      workspaceRoot,
      {
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
      },
      this.agentDocumentStorage
    );
    this.writeLine(hooks, `  ${hrName} has joined as HR Director`);

    await this.permissionStorage.saveAsync(ceoAgent.id, {
      list: ['**/*'],
      read: ['**/*'],
      write: ['.ai-team/**/*', '.github/copilot-instructions.md', 'AGENTS.md', 'docs/**/*'],
    });

    await this.permissionStorage.saveAsync(hrAgent.id, {
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

    this.writeLine(hooks, `--- ${businessPhase.heading} ---`);
    for (const line of businessPhase.introLines) {
      this.writeLine(hooks, line);
    }

    const businessContext = await this.runWorkflowChatPhaseAsync(
      businessAgent,
      developerName,
      businessPhase,
      hooks,
      injected?.sessionManager
    );

    if (businessContext.length > 0) {
      await this.saveOnboardingPhaseTranscriptAsync(
        businessContext,
        businessAgent,
        developerName,
        businessPhase
      );
      this.writeLine(hooks, `Transcript saved to ${businessPhase.transcript.relativePath}`);
    }

    const planningPhase = getOnboardingPhase(onboardingWorkflow, 'team-planning');
    const planningAgent = resolveOnboardingPhaseAgent(planningPhase, ceoAgent, hrAgent);

    this.writeLine(hooks, `--- ${planningPhase.heading} ---`);
    for (const line of planningPhase.introLines) {
      this.writeLine(hooks, line);
    }

    const hrHistory = await this.runWorkflowChatPhaseAsync(
      planningAgent,
      developerName,
      planningPhase,
      hooks,
      injected?.sessionManager
    );

    if (hrHistory.length > 0) {
      await this.saveOnboardingPhaseTranscriptAsync(
        hrHistory,
        planningAgent,
        developerName,
        planningPhase
      );
      this.writeLine(hooks, `Transcript saved to ${planningPhase.transcript.relativePath}`);
    }

    const hireDirectives = parseHireDirectives(hrHistory);
    if (hireDirectives.length > 0) {
      this.writeLine(hooks, '');
      this.writeLine(hooks, '--- Hiring Team ---');
      const hiredAgents = await this.executeHiresAsync(hireDirectives, ceoAgent.id, hooks);
      this.writeLine(hooks, '');
      if (hiredAgents.length > 0) {
        this.writeLine(hooks, `✓ ${hiredAgents.length} agent(s) hired and ready.`);
      }
    } else {
      this.writeLine(hooks, '');
      this.writeLine(
        hooks,
        'No HIRE: directives found in HR conversation. You can hire agents later with `ait hire` or by chatting with your HR director.'
      );
    }

    const handoffSummary =
      hireDirectives.length > 0
        ? `Hiring wave completed with ${hireDirectives.length} proposed role(s). Team planning notes are saved in ${planningPhase.transcript.relativePath}.`
        : 'Initial onboarding and team planning are complete. No hires were executed yet.';

    this.writeLine(hooks, '');
    this.writeLine(hooks, `${hrName} (hr-director): HANDOFF: ${ceoName} | ${handoffSummary}`);
    this.writeLine(hooks, '');
    this.writeLine(hooks, '--- Onboarding Complete ---');
    this.writeLine(
      hooks,
      `Handing off to ${ceoAgent.name} (ceo) for execution planning in the normal chat flow...`
    );
    this.writeLine(hooks, '');

    await this.startChatAsync(
      ceoAgent.id,
      {
        pendingIntroduction: `${hrName} handed off to ${ceoName}. ${handoffSummary}`,
      },
      hooks,
      { sessionManager: injected?.sessionManager }
    );
  }

  private async executeHiresAsync(
    hires: HireDirective[],
    ceoAgentId: string,
    hooks?: InitRuntimeHooks
  ): Promise<Agent[]> {
    if (hires.length === 0) return [];

    const hiredAgents: Agent[] = [];
    for (const [index, hire] of hires.entries()) {
      const shouldHire = await requestConfirm(hooks, {
        message: `Hire now (${index + 1}/${hires.length}): ${hire.name} as ${hire.role}?`,
        default: true,
      });

      if (!shouldHire) {
        this.writeLine(hooks, `  - Skipped ${hire.name} (${hire.role})`);
        continue;
      }

      const roleType = inferRoleType(hire.role);
      const preset = getPersonalityForHire(hire.role, roleType);

      let reportsTo: string | undefined;
      if (/architect|cto/.test(hire.role.toLowerCase())) {
        reportsTo = ceoAgentId;
      } else {
        const architect = hiredAgents.find((a) => /architect|cto/.test(a.role));
        reportsTo = architect?.id ?? ceoAgentId;
      }

      const markdown = this.agentDocumentStorage.buildAgentMarkdown({
        personalityProfile: preset.profile,
      });

      try {
        const agent = await this.agentManager.createAgentAsync(
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

        await this.permissionStorage.saveAsync(agent.id, {
          list: ['**/*'],
          read: ['**/*'],
          write: ['.ai-team/**/*', 'docs/**/*'],
        });

        hiredAgents.push(agent);
        this.writeLine(hooks, `  ✓ Hired ${agent.name} as ${agent.role} (reports to ${reportsTo})`);
      } catch (err) {
        this.writeWarn(
          hooks,
          `  ✗ Could not hire ${hire.name} as ${hire.role}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return hiredAgents;
  }

  private async runWorkflowChatPhaseAsync(
    agent: Agent,
    developerName: string | undefined,
    phase: OnboardingWorkflowPhase,
    hooks?: InitRuntimeHooks,
    sessionManager?: SessionManager
  ): Promise<ChatMessage[]> {
    const workspaceRoot = this.agentManager.workspaceRoot;

    await this.startChatAsync(
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
      hooks,
      sessionManager ? { sessionManager } : undefined
    );

    const sm =
      sessionManager ??
      (await (async () => {
        const { SqliteBackend, NotesRepository, MessagesRepository, SessionsRepository } =
          await import('@ai-team/infrastructure');
        const backend = new SqliteBackend(workspaceRoot);
        const notes = new NotesRepository(workspaceRoot, backend.ensureReadyAsync, backend.getDb);
        const messages = new MessagesRepository(backend.ensureReadyAsync, backend.getDb);
        const sessions = new SessionsRepository(backend.ensureReadyAsync, backend.getDb, notes);
        return new SessionManager(workspaceRoot, messages, sessions, notes, this.agentManager);
      })());

    try {
      const latestSession = await sm.getLatestSession(agent.id);
      if (!latestSession) return [];
      return await sm.getSessionMessages(latestSession.id);
    } finally {
      if (!sessionManager) await sm.close();
    }
  }

  private async startChatAsync(
    agentId: string,
    options: {
      pendingIntroduction?: string;
      createNewSession?: boolean;
      workflowMode?: boolean;
      workflowSystemPrompt?: string;
      workflowExitWords?: string[];
      suppressAutoIntroduction?: boolean;
      disableProcessExit?: boolean;
    },
    hooks?: InitRuntimeHooks,
    injected?: { sessionManager?: SessionManager }
  ): Promise<void> {
    const workspaceRoot = this.agentManager.workspaceRoot;
    const { ChatCommand } = await import('./chat/index.js');

    const agentDocumentStorage = this.agentDocumentStorage;

    const cmd = new ChatCommand(
      this.configurationStorage,
      this.environmentStorage,
      agentDocumentStorage
    );

    await cmd.execute(
      workspaceRoot,
      agentId,
      options,
      {
        signal: hooks?.signal,
        emit: hooks?.emit,
        questionInput: hooks?.questionInput,
        questionConfirm: hooks?.questionConfirm,
        questionSelect: hooks?.questionSelect,
        questionPassword: hooks?.questionPassword,
        questionChecklist: hooks?.questionChecklist,
      },
      {
        sessionManager: injected?.sessionManager,
        agentManager: this.agentManager,
      }
    );
  }

  private async saveOnboardingPhaseTranscriptAsync(
    history: ChatMessage[],
    agent: Agent,
    developerName: string | undefined,
    phase: OnboardingWorkflowPhase
  ): Promise<void> {
    const workspaceRoot = this.agentManager.workspaceRoot;
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
}
