import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  Agent,
  CommandResponse,
  ExecutionContext,
  IAgentManager,
  ICommand,
  ICommandDescriptor,
  IPermissionStorage,
} from '@ai-team/core';

const FINALIZER_PATH = ['.ai-team', 'private', 'hiring-completion-finalized.json'];
const CANONICAL_ROLE = 'head-of-development' as const;
const MIN_REQUIRED_WRITE_PATTERNS = ['.ai-team/**/*', 'docs/**/*'];

const checkHiringCompletionParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
  ceoAgentId: z.string().min(1),
  hrAgentId: z.string().min(1),
});

const finalizeHiringCompletionParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
  ceoAgentId: z.string().min(1),
  hrAgentId: z.string().min(1),
});

export interface HiringCheck {
  done: boolean;
  unmet: Array<{
    code: string;
    message: string;
  }>;
  headOfDevelopment?: {
    agentId: string;
    name: string;
    canonicalRole: 'head-of-development';
    reportsTo: string;
    active: true;
    permissionsValid: true;
  };
}

export interface HiringFinalizedOutput {
  headOfDevelopment: {
    agentId: string;
    name: string;
    canonicalRole: 'head-of-development';
    reportsTo: string;
    active: true;
    permissionsValid: true;
  };
  ceoAgentId: string;
  hrAgentId: string;
  approvalMessageId: string;
  approvalTimestamp: string;
  finalizedAt: string;
  summary: string;
}

interface HiringEvidence {
  headOfDevelopmentAgent: Agent;
  approvalMessageId: string;
  approvalTimestamp: string;
}

interface HiringFinalizedRecord {
  evidenceKey: string;
  output: HiringFinalizedOutput;
}

export const CheckHiringCompletionCommandMetadata = {
  key: 'check_hiring_completion',
  group: 'init',
  description:
    'Validate HR hiring completion against canonical Head-of-Development role, reporting, permissions, and explicit developer confirmation.',
  availableIn: { tool: true },
  parameters: checkHiringCompletionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export const FinalizeHiringCompletionCommandMetadata = {
  key: 'finalize_hiring_completion',
  group: 'init',
  description: 'Finalize hiring completion output idempotently for the validated hiring evidence.',
  availableIn: { tool: true },
  parameters: finalizeHiringCompletionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export class CheckHiringCompletionCommand
  implements ICommand<z.infer<typeof checkHiringCompletionParamsSchema>, HiringCheck>
{
  readonly metadata = CheckHiringCompletionCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: Pick<IAgentManager, 'getAllAgentsAsync'>,
    private readonly permissionStorage: IPermissionStorage
  ) {}

  async execute(
    params: z.infer<typeof checkHiringCompletionParamsSchema>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<HiringCheck>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_check_hiring_completion requires a workspaceRoot.' };
    }
    return {
      status: 'ok',
      data: await checkHiringCompletionAsync(
        {
          ceoAgentId: params.ceoAgentId,
          hrAgentId: params.hrAgentId,
          workspaceRoot,
        },
        ctx,
        this.agentManager,
        this.permissionStorage
      ),
    };
  }
}

export class FinalizeHiringCompletionCommand
  implements ICommand<z.infer<typeof finalizeHiringCompletionParamsSchema>, HiringFinalizedOutput>
{
  readonly metadata = FinalizeHiringCompletionCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: Pick<IAgentManager, 'getAllAgentsAsync'>,
    private readonly permissionStorage: IPermissionStorage
  ) {}

  async execute(
    params: z.infer<typeof finalizeHiringCompletionParamsSchema>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<HiringFinalizedOutput>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_finalize_hiring_completion requires a workspaceRoot.' };
    }

    const check = await checkHiringCompletionAsync(
      { ceoAgentId: params.ceoAgentId, hrAgentId: params.hrAgentId, workspaceRoot },
      ctx,
      this.agentManager,
      this.permissionStorage
    );

    if (!check.done || !check.headOfDevelopment) {
      return {
        status: 'error',
        message: `Hiring completion is not ready: ${check.unmet.map((item) => item.message).join('; ')}`,
      };
    }

    const evidence = resolveHiringEvidence(ctx, check.headOfDevelopment.name, check.headOfDevelopment.agentId);
    if (!evidence) {
      return {
        status: 'error',
        message: 'Missing explicit developer confirmation for selected Head of Development.',
      };
    }
    const evidenceKey = computeEvidenceKey(params.ceoAgentId, params.hrAgentId, evidence);
    const existing = await loadFinalizedRecordAsync(workspaceRoot);
    if (existing?.evidenceKey === evidenceKey) {
      return { status: 'ok', data: existing.output };
    }

    const output: HiringFinalizedOutput = {
      headOfDevelopment: {
        agentId: check.headOfDevelopment.agentId,
        name: check.headOfDevelopment.name,
        canonicalRole: CANONICAL_ROLE,
        reportsTo: check.headOfDevelopment.reportsTo,
        active: true,
        permissionsValid: true,
      },
      ceoAgentId: params.ceoAgentId,
      hrAgentId: params.hrAgentId,
      approvalMessageId: evidence.approvalMessageId,
      approvalTimestamp: evidence.approvalTimestamp,
      finalizedAt: new Date().toISOString(),
      summary: `Confirmed ${check.headOfDevelopment.name} as Head of Development reporting to CEO ${params.ceoAgentId}.`,
    };

    await saveFinalizedRecordAsync(workspaceRoot, { evidenceKey, output });
    return { status: 'ok', data: output };
  }
}

async function checkHiringCompletionAsync(
  params: { ceoAgentId: string; hrAgentId: string; workspaceRoot: string },
  ctx: ExecutionContext,
  agentManager: Pick<IAgentManager, 'getAllAgentsAsync'>,
  permissionStorage: IPermissionStorage
): Promise<HiringCheck> {
  const unmet: HiringCheck['unmet'] = [];
  const agents = await agentManager.getAllAgentsAsync();
  const candidates = agents.filter((agent) => isCanonicalHeadOfDevelopmentCandidate(agent));

  if (candidates.length === 0) {
    unmet.push({
      code: 'head_of_development_missing',
      message: 'No active Head of Development (or approved equivalent) is present.',
    });
    return { done: false, unmet };
  }

  const validCandidates: Agent[] = [];
  for (const candidate of candidates) {
    if (candidate.reportsTo !== params.ceoAgentId) {
      continue;
    }
    if (!hasTechnicalDeliveryResponsibility(candidate)) {
      continue;
    }
    const permissions = await permissionStorage.loadAsync(candidate.id);
    if (!isPermissionSetValid(permissions.read, permissions.list, permissions.write)) {
      continue;
    }
    validCandidates.push(candidate);
  }

  if (validCandidates.length === 0) {
    const candidateWithRole = candidates[0];
    if (candidateWithRole?.reportsTo !== params.ceoAgentId) {
      unmet.push({
        code: 'head_of_development_reports_to_mismatch',
        message: 'Head of Development must report directly to the CEO.',
      });
    } else {
      const permissions = candidateWithRole
        ? await permissionStorage.loadAsync(candidateWithRole.id)
        : { read: [], list: [], write: [] };
      if (!isPermissionSetValid(permissions.read, permissions.list, permissions.write)) {
        unmet.push({
          code: 'head_of_development_permissions_missing',
          message: 'Head of Development permissions must be persisted with read/list plus required write scopes.',
        });
      }
      if (!hasTechnicalDeliveryResponsibility(candidateWithRole)) {
        unmet.push({
          code: 'head_of_development_responsibility_missing',
          message: 'Head of Development must have technical-delivery responsibility recorded.',
        });
      }
    }
    return { done: false, unmet };
  }

  const selected = validCandidates[0]!;
  const evidence = resolveHiringEvidence(ctx, selected.name, selected.id);
  if (!evidence) {
    unmet.push({
      code: 'developer_confirmation_missing',
      message:
        'Developer must explicitly confirm the selected Head of Development hire before return.',
    });
    return { done: false, unmet };
  }

  return {
    done: true,
    unmet: [],
    headOfDevelopment: {
      agentId: selected.id,
      name: selected.name,
      canonicalRole: CANONICAL_ROLE,
      reportsTo: selected.reportsTo ?? '',
      active: true,
      permissionsValid: true,
    },
  };
}

function isCanonicalHeadOfDevelopmentCandidate(agent: Agent): boolean {
  const role = normalize(agent.role);
  const isCanonical = [
    'head of development',
    'head-of-development',
    'head of engineering',
    'engineering director',
    'director of engineering',
    'vp engineering',
    'vice president engineering',
    'cto',
    'chief technology officer',
  ].some((entry) => role.includes(entry));

  if (!isCanonical) {
    return false;
  }

  return hasTechnicalDeliveryResponsibility(agent);
}

function hasTechnicalDeliveryResponsibility(agent: Agent): boolean {
  const searchFields = [
    agent.role,
    agent.description ?? '',
    ...(agent.specializations ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return /(technical delivery|engineering delivery|software delivery|architecture|platform|engineering)/i.test(
    searchFields
  );
}

function isPermissionSetValid(read: string[] | undefined, list: string[] | undefined, write: string[]): boolean {
  if (!read?.length || !list?.length) return false;
  return MIN_REQUIRED_WRITE_PATTERNS.every((required) =>
    write.some((pattern) => normalize(pattern) === normalize(required))
  );
}

function resolveHiringEvidence(
  ctx: ExecutionContext,
  candidateName: string,
  candidateAgentId: string
): HiringEvidence | undefined {
  const normalizedName = normalize(candidateName);
  const messages = [...ctx.history].reverse().filter((message) => message.isHuman && !message.hiddenFromLlm);
  for (const message of messages) {
    const content = normalize(message.content);
    const confirms = /\b(i approve|approved|confirm|confirmed|yes,? hire|go with|proceed with)\b/i.test(
      content
    );
    if (!confirms) continue;
    const referencesCandidate =
      content.includes(normalizedName) ||
      content.includes(normalize(candidateAgentId)) ||
      content.includes('head of development');
    if (!referencesCandidate) continue;
    return {
      headOfDevelopmentAgent: {
        id: candidateAgentId,
        name: candidateName,
      } as Agent,
      approvalMessageId: String(message.id ?? `message-${message.timestamp}`),
      approvalTimestamp: message.timestamp,
    };
  }
  return undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function computeEvidenceKey(
  ceoAgentId: string,
  hrAgentId: string,
  evidence: HiringEvidence
): string {
  const payload = JSON.stringify({
    ceoAgentId,
    hrAgentId,
    headOfDevelopmentAgentId: evidence.headOfDevelopmentAgent.id,
    approvalMessageId: evidence.approvalMessageId,
    approvalTimestamp: evidence.approvalTimestamp,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function loadFinalizedRecordAsync(
  workspaceRoot: string
): Promise<HiringFinalizedRecord | undefined> {
  const filePath = path.join(workspaceRoot, ...FINALIZER_PATH);
  const raw = await readFileSafe(filePath);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Partial<HiringFinalizedRecord>;
  if (typeof parsed.evidenceKey !== 'string' || !parsed.output || typeof parsed.output !== 'object') {
    throw new Error(`Hiring finalizer record at '${filePath}' is invalid.`);
  }
  return parsed as HiringFinalizedRecord;
}

async function saveFinalizedRecordAsync(
  workspaceRoot: string,
  record: HiringFinalizedRecord
): Promise<void> {
  const filePath = path.join(workspaceRoot, ...FINALIZER_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}

async function readFileSafe(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

