import fs from 'node:fs/promises';
import path from 'node:path';
import {
  saveAgentAccessPatterns,
  loadSkill,
  loadAllInstructionFiles,
  LlmService,
  ChatStorage,
  AgentManager,
  buildAgentMarkdown,
  ContextLevel,
  RoleType,
} from '@ai-team/infrastructure';
import type { Agent, ChatMessage, ChatCompletionMessageParam } from '@ai-team/infrastructure';
import { getPersonalityForHire } from './hire.js';
import type { InitOptions } from '@ai-team/api-client';
import { getGitUserName, developerNameToId } from '../utils/git.js';
import { listEmployeesCommand } from './list.js';
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
  requestChecklist,
} from './init/workflow-questions.js';
import { pickAgentName } from './init/name-picking.js';
import { createAgentFile } from './init/agent-file.js';
import {
  getIdeaClarifierQuestion,
  getGuidedInitialSuggestions,
  getGuidedDependentSuggestions,
} from './init/guided-onboarding.js';
import { runInitWorkflowAsync } from './init-workflow.js';

function writeToken(hooks: InitRuntimeHooks | undefined, text: string) {
  hooks?.emit?.({ kind: 'token', text });
  if (!hooks?.emit) {
    process.stdout.write(text);
  }
}

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

function writeError(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'error', message });
  if (!hooks?.emit) {
    process.stderr.write(`${message}\n`);
  }
}

function writeDebug(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'debug', message });
  if (!hooks?.emit) {
    process.stdout.write(`\x1b[2m${message}\x1b[0m\n`);
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

  writeLine(hooks, '--- Business Definition ---');
  writeLine(
    hooks,
    `\n${ceoName} (CEO): Welcome. I'm ${ceoName}, your CEO. I keep things strategic, outcome-focused, and short. Let's define what this software is about — start with your idea in plain text.\n`
  );
  const ideaText = await requestInput(hooks, {
    message: 'Describe your idea in your own words (2-6 sentences):',
    validate: (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 20)
        return 'Please add a little more detail so we can generate useful options.';
      if (trimmed.length > 4000) return 'Please keep it concise (max ~4000 characters).';
      return true;
    },
  });

  const clarifier = await getIdeaClarifierQuestion(llm, ideaText);
  const productIntentAndPainPoint = await requestInput(hooks, {
    message: clarifier.question,
    validate: (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length < 20)
        return 'Please include both product type and the first pain point to eliminate.';
      if (trimmed.length > 4000) return 'Please keep it concise (max ~4000 characters).';
      return true;
    },
  });

  const guidedIdeaContext = [
    ideaText.trim(),
    '',
    `Product target + first pain point: ${productIntentAndPainPoint.trim()}`,
  ].join('\n');

  writeLine(
    hooks,
    `\n${ceoName} (CEO): Good. I have enough to work with. Shall I ask you a few focused questions to sharpen the plan, or do you want to skip straight to discussion?`
  );
  const guidedMode = await requestConfirm(hooks, {
    message: 'Let the CEO guide you with focused questions?',
    default: true,
  });

  const businessSeed: string[] = [];
  let guidedSelectionContext:
    | { mode: string; priorities: string[]; constraints: string[] }
    | undefined;
  businessSeed.push(`- Idea summary (developer): ${ideaText.trim()}`);
  businessSeed.push(`- Product target and first pain point: ${productIntentAndPainPoint.trim()}`);
  if (guidedMode) {
    let dynamicProductModes: Array<{ name: string; value: string }> | undefined;
    let dynamicPriorities: Array<{ name: string; value: string }> | undefined;
    try {
      const initialSuggestions = await getGuidedInitialSuggestions(llm, guidedIdeaContext);
      dynamicProductModes = initialSuggestions.productModes;
      dynamicPriorities = initialSuggestions.priorities;
    } catch (error) {
      writeWarn(
        hooks,
        `Could not generate inspiring guided options yet; switching to text input for this step. (${error instanceof Error ? error.message : String(error)})`
      );
    }

    const businessFocus = dynamicProductModes
      ? await requestSelect(hooks, {
          message: 'Which product direction fits best right now?',
          choices: dynamicProductModes,
        })
      : await requestInput(hooks, {
          message: 'What product direction best fits your idea right now?',
          validate: (value) => value.trim().length > 0 || 'Please provide a product direction.',
        });

    const priorities = dynamicPriorities
      ? await requestChecklist(hooks, {
          message: 'Pick top priorities that should drive decisions:',
          choices: dynamicPriorities,
        })
      : (
          await requestInput(hooks, {
            message: 'List your top priorities (comma-separated):',
            validate: (value) => value.trim().length > 0 || 'Please provide at least one priority.',
          })
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);

    let constraints: string[] = [];
    try {
      const dependentSuggestions = await getGuidedDependentSuggestions(llm, {
        ideaText: guidedIdeaContext,
        selectedProductMode: businessFocus,
        selectedPriorities: priorities,
      });
      constraints = await requestChecklist(hooks, {
        message: 'Pick key constraints (optional):',
        choices: dependentSuggestions.constraints,
      });
    } catch (error) {
      writeWarn(
        hooks,
        `Could not tailor constraints from your selections; switching to text input. (${error instanceof Error ? error.message : String(error)})`
      );
      constraints = (
        await requestInput(hooks, {
          message: 'List key constraints (comma-separated, optional; press enter to skip):',
        })
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }

    guidedSelectionContext = {
      mode: businessFocus,
      priorities,
      constraints,
    };

    businessSeed.push(`- Product mode: ${businessFocus}`);
    if (priorities.length > 0) {
      businessSeed.push(`- Priorities: ${priorities.join(', ')}`);
    }
    if (constraints.length > 0) {
      businessSeed.push(`- Constraints: ${constraints.join(', ')}`);
    }
  }

  // CEO presents a business plan summary based on gathered inputs
  writeLine(hooks, `\n${ceoName} (CEO): Here is my take on the business plan.\n`);
  const developerName = getGitUserName();
  const planSystemPrompt = [
    `You are ${ceoName}, CEO. Based on the developer's inputs below, present a clear, structured business plan summary.`,
    'Use numbered bullets. Cover: problem, target users, value proposition, success criteria, and key constraints.',
    'End by inviting the developer to critique, refine, or approve the plan.',
    'Be concise — executive style, no fluff.',
    '',
    '## Developer inputs',
    businessSeed.join('\n'),
  ].join('\n');
  const planMessages: Array<{ role: 'user'; content: string }> = [
    { role: 'user', content: 'Present the business plan based on what we discussed.' },
  ];

  let planSummary = '';
  try {
    writeToken(hooks, `${ceoName} (CEO): `);
    const planStream = await llm.rawStreamChat(planSystemPrompt, planMessages);
    for await (const chunk of planStream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        writeToken(hooks, delta);
        planSummary += delta;
      }
    }
    writeToken(hooks, '\n\n');
  } catch (err) {
    writeWarn(
      hooks,
      `Could not generate plan summary: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  writeLine(hooks, 'Discuss the plan with the CEO. Critique it, praise it, or refine it.');
  writeLine(hooks, 'Say "done" or "let\'s move on" when you are ready to continue.\n');

  // Seed the chat history with the plan so the CEO remembers it
  const seedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (planSummary.trim()) {
    seedMessages.push({ role: 'assistant', content: planSummary.trim() });
  }

  const businessContext = await onboardingChat(
    workspaceRoot,
    llm,
    ceoAgent,
    'done',
    [
      renderTemplate(templates.onboardingCeoSystemPrompt, { hrName }),
      businessSeed.length > 0 ? `\n## Guided onboarding answers\n${businessSeed.join('\n')}` : '',
    ]
      .join('\n')
      .trim(),
    developerName,
    hooks,
    seedMessages
  );

  if (businessContext.length > 0) {
    await saveBusinessContext(workspaceRoot, businessContext);
    writeLine(hooks, 'Business context saved to .ai-team/business.md');
  }

  writeLine(hooks, '--- Team Planning ---');
  writeLine(hooks, `Talk with ${hrName} about what roles you need on the team.`);
  writeLine(hooks, 'Say "done" or "let\'s go" when you are finished.');

  const hiringSeed: string[] = [];
  if (guidedMode) {
    let mustHaveRoles: string[] = [];
    try {
      const selectedProductMode = guidedSelectionContext?.mode ?? 'unknown';
      const selectedPriorities = guidedSelectionContext?.priorities ?? [];
      const selectedConstraints = guidedSelectionContext?.constraints ?? [];

      const dependentSuggestions = await getGuidedDependentSuggestions(llm, {
        ideaText: guidedIdeaContext,
        selectedProductMode,
        selectedPriorities,
        selectedConstraints,
      });
      mustHaveRoles = await requestChecklist(hooks, {
        message: 'Pick must-have roles for first hiring wave:',
        choices: dependentSuggestions.mustHaveRoles,
      });
    } catch (error) {
      writeWarn(
        hooks,
        `Could not generate role options from previous selections; switching to text input. (${error instanceof Error ? error.message : String(error)})`
      );
      mustHaveRoles = (
        await requestInput(hooks, {
          message: 'List must-have roles for first hiring wave (comma-separated):',
          validate: (value) => value.trim().length > 0 || 'Please provide at least one role.',
        })
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }

    if (mustHaveRoles.length > 0) {
      hiringSeed.push(`- First-wave roles: ${mustHaveRoles.join(', ')}`);
    }
  }

  const hrHistory = await onboardingChat(
    workspaceRoot,
    llm,
    hrAgent,
    'done',
    [
      renderTemplate(templates.onboardingHrSystemPrompt, { hrName }),
      hiringSeed.length > 0 ? `\n## Guided hiring inputs\n${hiringSeed.join('\n')}` : '',
    ]
      .join('\n')
      .trim(),
    developerName,
    hooks
  );

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

  writeLine(hooks, '');
  writeLine(hooks, '--- Onboarding Complete ---');
  writeLine(hooks, `Your CEO ${ceoAgent.name} is ready to chat. Entering interactive mode...`);
  writeLine(hooks, '');

  // Import chatCommand lazily to avoid circular dependency issues
  const { chatCommand: startChat } = await import('./chat/index.js');
  await startChat(
    workspaceRoot,
    ceoAgent.id,
    {},
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
  for (const hire of hires) {
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

// ── Onboarding exit detection ───────────────────────────────────────────────

const ONBOARDING_COMPLETION_PATTERNS = [
  /\blet'?s\s+(?:start|begin|go|move\b|proceed|continue|do\s+it|roll|get\s+started)/i,
  /\bthat'?s\s+(?:enough|all|it|good|fine|great|perfect)\b/i,
  /\bwe'?(?:re|r)\s+(?:good|ready|done|set|all\s+set)/i,
  /\bi'?(?:m|am)\s+(?:ready|good|done|satisfied|happy\s+with)/i,
  /\b(?:go\s+ahead|go\s+for\s+it|sounds?\s+good|looks?\s+good)\b/i,
  /\b(?:wrap\s+(?:it\s+)?up|finish\s+up|move\s+on|move\s+forward)\b/i,
  /\b(?:that\s+covers?\s+it|that\s+should\s+(?:do|be\s+enough))\b/i,
  /\b(?:i\s+think\s+we\s+(?:have|got)\s+enough)\b/i,
  /\b(?:start\s+(?:with\s+)?(?:the\s+)?hiring|begin\s+hiring|hire\s+(?:them|everyone|the\s+team))\b/i,
  /\b(?:nothing\s+(?:else|more)|no\s+(?:more\s+)?(?:changes?|questions?|additions?))\b/i,
];

const ONBOARDING_FORWARD_PATTERNS = [
  /(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|over\s+to)\s+/i,
  /(?:let me|i(?:'d| would) like to)\s+(?:talk|speak|chat)\s+(?:to|with)\s+/i,
  /(?:can (?:you|i)|please)\s+(?:forward|transfer|connect|switch|redirect)\s+(?:me\s+)?(?:to|with)\s+/i,
  /(?:put me through|patch me through|hand me off)\s+(?:to)\s+/i,
  /(?:i (?:want|need) to (?:talk|speak|chat) (?:to|with))\s+/i,
  /(?:take me to|send me to|bring me to)\s+/i,
];

function isForwardingRequest(message: string): boolean {
  return ONBOARDING_FORWARD_PATTERNS.some((p) => p.test(message));
}

function isCompletionIntent(message: string): boolean {
  return ONBOARDING_COMPLETION_PATTERNS.some((p) => p.test(message));
}

async function onboardingChat(
  workspaceRoot: string,
  llm: LlmService,
  agent: Agent,
  exitWord: string,
  extraSystemContext: string,
  developerName: string | undefined,
  hooks?: InitRuntimeHooks,
  seedMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ChatMessage[]> {
  const chatStorage = new ChatStorage(workspaceRoot);
  const history: ChatMessage[] = [];
  const messages: ChatCompletionMessageParam[] = [];

  let skill;
  try {
    skill = await loadSkill(agent.skillPath);
    writeDebug(hooks, `Loaded skill: ${skill.name} (${agent.skillPath})`);
  } catch {
    // Skill file may not exist — that's fine during onboarding
  }

  // Load workspace instruction files
  const instructions = await loadAllInstructionFiles(workspaceRoot);
  if (instructions.length > 0) {
    writeDebug(hooks, `Loaded ${instructions.length} instruction file(s)`);
  }

  const personaParts: string[] = [];
  personaParts.push(`You are ${agent.name}, ${agent.role}.`);
  if (agent.personality?.communication_style) {
    personaParts.push(`Communication style: ${agent.personality.communication_style}`);
  }
  if (skill?.instructions) {
    personaParts.push(skill.instructions);
  }
  if (agent.markdown?.trim()) {
    personaParts.push(agent.markdown.trim());
  }
  personaParts.push('');
  personaParts.push(extraSystemContext);

  try {
    const bizCtx = await fs.readFile(path.join(workspaceRoot, '.ai-team', 'business.md'), 'utf-8');
    if (bizCtx.trim()) {
      personaParts.push('');
      personaParts.push('## Business Context');
      personaParts.push(bizCtx);
    }
  } catch {}

  if (instructions.length > 0) {
    personaParts.push('');
    personaParts.push('## Workspace Instructions');
    for (const inst of instructions) {
      personaParts.push(`### ${inst.filePath} (applies to: ${inst.applyTo})`);
      personaParts.push(inst.instructions);
    }
  }

  const systemPrompt = personaParts.join('\n');

  // Seed the LLM message history (e.g. the CEO's pre-generated plan summary)
  if (seedMessages?.length) {
    for (const seed of seedMessages) {
      messages.push({ role: seed.role, content: seed.content });
      if (seed.role === 'assistant') {
        const agentMsg: ChatMessage = {
          timestamp: new Date().toISOString(),
          from: agent.id,
          to: 'human',
          content: seed.content,
        };
        history.push(agentMsg);
        await chatStorage.appendMessage(agent.id, agentMsg);
      }
    }
  }

  while (true) {
    const userText = await requestInput(hooks, {
      message: 'You:',
      validate: (v: string) => v.length > 0 || 'Message cannot be empty',
    });

    const lower = userText.toLowerCase().trim();
    if (lower === exitWord || lower === 'exit' || lower === 'quit') {
      writeLine(hooks, 'Moving on...');
      break;
    }

    // Natural language forwarding — treat "forward me to X" as done
    if (isForwardingRequest(userText)) {
      writeLine(hooks, `Moving on to the next phase...`);
      break;
    }

    // Natural language completion — "let's go", "sounds good", "wrap it up", etc.
    if (isCompletionIntent(userText)) {
      writeLine(hooks, 'Moving on to the next phase...');
      break;
    }

    // Slash command interception
    if (userText.startsWith('/')) {
      const [rawCmd] = userText.slice(1).split(/\s+/);
      const cmd = rawCmd?.toLowerCase() ?? '';
      if (cmd === 'list') {
        const employees = await listEmployeesCommand(workspaceRoot, {});
        if (employees.length === 0) {
          writeLine(hooks, 'No employees found.');
        } else {
          writeLine(hooks, '\nEmployees:\n');
          for (const emp of employees) {
            writeLine(hooks, `  ${emp.name} (${emp.role}) [${emp.id}]`);
          }
        }
        continue;
      } else if (cmd === 'exit' || cmd === 'quit' || cmd === 'done') {
        writeLine(hooks, 'Moving on...');
        break;
      } else {
        writeLine(
          hooks,
          `Unknown command: /${cmd}. Available in this mode: /list (show team), /done (end conversation).`
        );
        continue;
      }
    }

    const developerId = developerName ? developerNameToId(developerName) : 'human';
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: developerId,
      isHuman: true,
      content: userText,
    };
    history.push(userMsg);
    await chatStorage.appendMessage(agent.id, userMsg);
    messages.push({ role: 'user' as const, content: userText });

    writeToken(hooks, `\n${agent.name} (${agent.role}): `);
    let fullReply = '';
    try {
      const stream = await llm.rawStreamChat(systemPrompt, messages);
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          writeToken(hooks, delta);
          fullReply += delta;
        }
      }
    } catch (err) {
      writeError(hooks, `LLM error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    writeToken(hooks, '\n\n');

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: agent.id,
      to: 'human',
      content: fullReply.trim(),
    };
    history.push(agentMsg);
    await chatStorage.appendMessage(agent.id, agentMsg);
    messages.push({ role: 'assistant' as const, content: fullReply.trim() });
  }

  return history;
}

async function saveBusinessContext(workspaceRoot: string, history: ChatMessage[]) {
  const lines: string[] = ['# Business Definition\n'];
  lines.push('> The core business problem this software solves.\n');
  lines.push('> Generated during `ait init` onboarding with the CEO.\n');
  for (const msg of history) {
    const speaker = msg.from === 'human' ? 'Developer' : msg.from;
    lines.push(`**${speaker}:** ${msg.content}\n`);
  }
  const filePath = path.join(workspaceRoot, '.ai-team', 'business.md');
  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}
