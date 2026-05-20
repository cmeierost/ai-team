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
  ISkillManager,
  IMarkdownSectionService,
  IPathPermissionChecker,
  IAgentDocumentStorage,
  IProposalStoreFactory,
  IDeveloperIdentityService,
  IServiceContainer,
  Agent,
  ChatMessage,
  ICommand,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { z } from 'zod';
import { ContextLevel, RoleType, resolveEffectiveLlmSettings } from '@ai-team/core';
import type { IContextService, OnboardOptions } from '@ai-team/api-contracts';
import { SessionManager } from '../../session-manager.js';
import {
  createRoleTemplates,
  createBootstrapWorkspaceFiles,
  createBootstrapInstructions,
  createBootstrapSkills,
  createBootstrapTemplateFiles,
} from '../init/bootstrap-files.js';
import {
  INIT_TEMPLATE_FILE_MAP,
  type InitTemplateKey,
  getWorkspaceTemplatePath,
  readDefaultTemplate,
  loadInitTemplates,
  renderTemplate,
  parseTemplateBulletList,
} from '../init/template-utils.js';
import {
  type InitRuntimeHooks,
  requestInput,
  requestConfirm,
  requestSelect,
} from '../init/workflow-questions.js';
import type { IQuestionService } from '../../questions/question-service.js';
import { pickAgentName } from '../init/name-picking.js';
import { createAgentFile } from '../init/agent-file.js';
import { saveOnboardingTranscriptAsync } from '../init/onboarding-docs.js';
import {
  loadOnboardingWorkflowDefinitionFromTemplates,
  getOnboardingPhase,
  type OnboardingWorkflowPhase,
} from '../init/onboarding-workflow-definition.js';
import { getPersonalityForHire } from './hire.js';

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

type OnboardICommandParams = z.infer<typeof OnboardICommand.schema>;

export class OnboardICommand implements ICommand<OnboardICommandParams, void> {
  static readonly schema = z.object({
    options: z.any().optional(),
  });

  readonly key = 'onboard';
  readonly cli = { command: 'onboard' };
  readonly description = 'Run team onboarding (CEO + HR + hiring)';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'hr';
  readonly parameters = OnboardICommand.schema;

  constructor(
    private readonly onboardCommand: Pick<OnboardCommand, 'execute'>,
    private readonly sessionManager: SessionManager | undefined,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: OnboardICommandParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<void>> {
    await this.onboardCommand.execute(
      {
        options: (payload.options ?? {}) as OnboardOptions,
        injected: this.sessionManager ? { sessionManager: this.sessionManager } : undefined,
      },
      this.buildHooks(ctx)
    );
    return { status: 'ok' };
  }

  private buildHooks(runtime: ExecutionContext): InitRuntimeHooks {
    return {
      signal: runtime.signal,
      emit: runtime.emit,
       input: (request, context) => this.questionService.input(request),
       confirm: (request, context) => this.questionService.confirm(request),
       select: (request, context) => this.questionService.select(request),
       password: (request, context) => this.questionService.password(request),
       checklist: (request, context) => this.questionService.checklist(request),
      workflowState: runtime.workflowState as InitRuntimeHooks['workflowState'],
      onWorkflowFrame: runtime.onWorkflowFrame,
    };
  }
}

export class OnboardCommand {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly permissionStorage: IPermissionStorage,
    private readonly workspaceRoot: string,
    private readonly agentDocumentStorage: IAgentDocumentStorage,
    private readonly proposalStoreFactory: IProposalStoreFactory,
    private readonly llmService: ILlmService,
    private readonly skillManager: ISkillManager,
    private readonly markdownSectionService: IMarkdownSectionService,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly contextService: Pick<IContextService, 'getContextEstimate'>,
    private readonly questionService: IQuestionService,
    private readonly defaultSessionManager?: SessionManager,
    private readonly developerIdentityService?: IDeveloperIdentityService,
    private readonly serviceContainer?: IServiceContainer
  ) {}

  async execute(params: OnboardCommandParams = {}, hooks?: InitRuntimeHooks): Promise<void> {
    const { injected } = params;
    const workspaceRoot = this.workspaceRoot;

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

    const llm = this.llmService;
    llm.initializeFromConfig(resolvedLlm.config, apiKey);

    this.writeLine(hooks, '');
    this.writeLine(hooks, 'Starting team onboarding...');

    await this.runOnboardingAsync(llm, hooks, injected);
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
    const workspaceRoot = this.workspaceRoot;
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
      writeWarn: (h: InitRuntimeHooks | undefined, m: string) => this.writeWarn(h, m),
    });
    this.writeLine(hooks, `CEO: My name is ${ceoName}.`);

    const hrName = await pickAgentName(
      llm,
      templates,
      'Head of Human Resources',
      [ceoName],
      hooks,
      {
        requestSelect,
        requestInput,
        writeWarn: (h: InitRuntimeHooks | undefined, m: string) => this.writeWarn(h, m),
      }
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

    const developerName = this.developerIdentityService?.getUserName();
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
      llm,
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
      llm,
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
      llm,
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
    llm: ILlmService,
    agent: Agent,
    developerName: string | undefined,
    phase: OnboardingWorkflowPhase,
    hooks?: InitRuntimeHooks,
    sessionManager?: SessionManager
  ): Promise<ChatMessage[]> {
    await this.startChatAsync(
      llm,
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

    const sm = sessionManager ?? this.defaultSessionManager;
    if (!sm) {
      throw new Error('OnboardCommand requires a SessionManager to load onboarding history.');
    }

    const latestSession = await sm.getLatestSession(agent.id);
    if (!latestSession) return [];
    return await sm.getSessionMessages(latestSession.id);
  }

  private async startChatAsync(
    llm: ILlmService,
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
    const workspaceRoot = this.workspaceRoot;
    const { InfoChatCommand, ChatCommand, ChatInfoService, ChatPreflightService } =
      await import('../chat/index.js');
    const sessionManager = injected?.sessionManager ?? this.defaultSessionManager;
    if (!sessionManager) {
      throw new Error('OnboardCommand requires a SessionManager to start workflow chat phases.');
    }
    if (!this.developerIdentityService) {
      throw new Error(
        'OnboardCommand requires DeveloperIdentityService to start workflow chat phases.'
      );
    }
    if (!this.serviceContainer) {
      throw new Error(
        'OnboardCommand requires IServiceContainer to resolve orchestration commands in workflow chats.'
      );
    }

    const cmd = new ChatCommand(
      {
        configurationStorage: this.configurationStorage,
        environmentStorage: this.environmentStorage,
        developerIdentityService: this.developerIdentityService,
        contextService: this.contextService,
      },
      {
        agentManager: this.agentManager,
        agentDocumentStorage: this.agentDocumentStorage,
        markdownSectionService: this.markdownSectionService,
        skillManager: this.skillManager,
      },
      {
        sessionManager,
        llmService: llm,
        proposalStoreFactory: this.proposalStoreFactory,
      },
      {
        pathPermissionChecker: this.pathPermissionChecker,
        serviceContainer: this.serviceContainer,
      },
      new ChatInfoService(),
      new ChatPreflightService(
        this.configurationStorage,
        this.environmentStorage,
        this.developerIdentityService
      ),
      new InfoChatCommand(this.agentManager, this.questionService)
    );

    await cmd.execute(workspaceRoot, agentId, options, {
      signal: hooks?.signal,
      emit: hooks?.emit,
       input: hooks?.input,
       confirm: hooks?.confirm,
       select: hooks?.select,
       password: hooks?.password,
       checklist: hooks?.checklist,
    });
  }

  private async saveOnboardingPhaseTranscriptAsync(
    history: ChatMessage[],
    agent: Agent,
    developerName: string | undefined,
    phase: OnboardingWorkflowPhase
  ): Promise<void> {
    const workspaceRoot = this.workspaceRoot;
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
