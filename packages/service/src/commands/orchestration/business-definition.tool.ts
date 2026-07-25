import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CommandResponse, ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';

const DEFAULT_MIN_MEANINGFUL_LENGTH = 600;
const MIN_SECTION_MEANINGFUL_LENGTH = 40;
const PLACEHOLDER_PATTERNS = [/^\s*(todo|tbd|n\/a|none)\s*$/i, /lorem ipsum/i];

const BUSINESS_PATH = ['.ai-team', 'business.md'];
const APPROVAL_PATH = ['.ai-team', 'private', 'business-definition-approval.json'];
const FINALIZER_PATH = ['.ai-team', 'private', 'business-definition-finalized.json'];

const sectionAliases = {
  problemStatement: ['problem statement', 'problem', 'problem definition'],
  primaryTargetUsers: ['primary target users', 'target users', 'target audience'],
  valueProposition: ['value proposition', 'core value proposition'],
  successCriteria: ['success criteria', 'measurable success criteria', 'metrics'],
  constraints: ['constraints', 'key constraints', 'constraints and non-goals'],
  nonGoals: ['non-goals', 'non goals', 'constraints and non-goals'],
} as const;

const checkBusinessDefinitionParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
  minMeaningfulLength: z.number().int().positive().optional(),
});

const approveBusinessDefinitionParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
  messageId: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
});

const finalizeBusinessDefinitionParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
  minMeaningfulLength: z.number().int().positive().optional(),
});

export interface BusinessDefinitionCheckFinding {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
  section?: string;
}

export interface BusinessDefinitionCheck {
  done: boolean;
  unmet: Array<{ code: string; message: string }>;
  findings: BusinessDefinitionCheckFinding[];
  evidence?: {
    documentPath: '.ai-team/business.md';
    documentRevision: string;
    meaningfulLength: number;
    requiredSections: string[];
    approvalMessageId: string;
    approvalTimestamp: string;
    evaluationRevision: string;
  };
}

export interface BusinessDefinitionFinalizedOutput {
  documentPath: '.ai-team/business.md';
  documentRevision: string;
  approvalMessageId: string;
  approvalTimestamp: string;
  evaluationRevision: string;
  finalizedAt: string;
  summary: {
    problemStatement: string;
    primaryTargetUsers: string;
    valueProposition: string;
    successCriteria: string[];
    constraints: string;
    nonGoals: string;
  };
}

interface BusinessDefinitionApprovalRecord {
  documentRevision: string;
  approvalMessageId: string;
  approvalTimestamp: string;
  capturedAt: string;
}

interface BusinessDefinitionFinalizedRecord {
  documentRevision: string;
  output: BusinessDefinitionFinalizedOutput;
}

export const CheckBusinessDefinitionCommandMetadata = {
  key: 'check_business_definition',
  group: 'init',
  description:
    'Validate .ai-team/business.md against required sections, quality criteria, revision, and approval requirements.',
  availableIn: { tool: true },
  parameters: checkBusinessDefinitionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export const ApproveBusinessDefinitionCommandMetadata = {
  key: 'approve_business_definition',
  group: 'init',
  description:
    'Capture explicit developer approval for the current business definition document revision.',
  availableIn: { tool: true },
  parameters: approveBusinessDefinitionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export const FinalizeBusinessDefinitionCommandMetadata = {
  key: 'finalize_business_definition',
  group: 'init',
  description:
    'Finalize business definition output idempotently for the approved document revision.',
  availableIn: { tool: true },
  parameters: finalizeBusinessDefinitionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export class CheckBusinessDefinitionCommand
  implements ICommand<z.infer<typeof checkBusinessDefinitionParamsSchema>, BusinessDefinitionCheck>
{
  readonly metadata = CheckBusinessDefinitionCommandMetadata;

  constructor(private readonly workspaceRoot: string) {}

  async execute(
    params: z.infer<typeof checkBusinessDefinitionParamsSchema>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<BusinessDefinitionCheck>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_check_business_definition requires a workspaceRoot.' };
    }
    return {
      status: 'ok',
      data: await checkBusinessDefinitionAsync(workspaceRoot, params.minMeaningfulLength),
    };
  }
}

export class ApproveBusinessDefinitionCommand
  implements ICommand<z.infer<typeof approveBusinessDefinitionParamsSchema>, BusinessDefinitionApprovalRecord>
{
  readonly metadata = ApproveBusinessDefinitionCommandMetadata;

  constructor(private readonly workspaceRoot: string) {}

  async execute(
    params: z.infer<typeof approveBusinessDefinitionParamsSchema>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<BusinessDefinitionApprovalRecord>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_approve_business_definition requires a workspaceRoot.' };
    }

    const businessPath = path.join(workspaceRoot, ...BUSINESS_PATH);
    const markdown = await readFileSafe(businessPath);
    if (!markdown) {
      return { status: 'error', message: '.ai-team/business.md does not exist.' };
    }
    const documentRevision = computeRevision(markdown);
    const approvalMessage = resolveApprovalMessage(ctx, params.messageId, params.timestamp);
    if (!approvalMessage) {
      return {
        status: 'error',
        message:
          'No explicit developer approval message found. Ask the developer to approve the current business definition explicitly.',
      };
    }
    if (!isExplicitApprovalMessage(approvalMessage.content)) {
      return {
        status: 'error',
        message:
          'Latest developer message is not explicit approval. Capture a clear approval message (for example: "I approve this business definition.").',
      };
    }

    const approval: BusinessDefinitionApprovalRecord = {
      documentRevision,
      approvalMessageId: approvalMessage.id,
      approvalTimestamp: approvalMessage.timestamp,
      capturedAt: new Date().toISOString(),
    };
    await saveApprovalRecordAsync(workspaceRoot, approval);
    return { status: 'ok', data: approval };
  }
}

export class FinalizeBusinessDefinitionCommand
  implements
    ICommand<z.infer<typeof finalizeBusinessDefinitionParamsSchema>, BusinessDefinitionFinalizedOutput>
{
  readonly metadata = FinalizeBusinessDefinitionCommandMetadata;

  constructor(private readonly workspaceRoot: string) {}

  async execute(
    params: z.infer<typeof finalizeBusinessDefinitionParamsSchema>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<BusinessDefinitionFinalizedOutput>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_finalize_business_definition requires a workspaceRoot.' };
    }

    const check = await checkBusinessDefinitionAsync(workspaceRoot, params.minMeaningfulLength);
    if (!check.done || !check.evidence) {
      return {
        status: 'error',
        message: `Business definition is not ready to finalize: ${check.unmet.map((u) => u.message).join('; ')}`,
      };
    }

    const existing = await loadFinalizedRecordAsync(workspaceRoot);
    if (existing?.documentRevision === check.evidence.documentRevision) {
      return { status: 'ok', data: existing.output };
    }

    const businessPath = path.join(workspaceRoot, ...BUSINESS_PATH);
    const markdown = await readFile(businessPath, 'utf8');
    const sections = parseSections(markdown);
    const output: BusinessDefinitionFinalizedOutput = {
      documentPath: '.ai-team/business.md',
      documentRevision: check.evidence.documentRevision,
      approvalMessageId: check.evidence.approvalMessageId,
      approvalTimestamp: check.evidence.approvalTimestamp,
      evaluationRevision: check.evidence.evaluationRevision,
      finalizedAt: new Date().toISOString(),
      summary: {
        problemStatement: getSectionByAliases(sections, sectionAliases.problemStatement) ?? '',
        primaryTargetUsers: getSectionByAliases(sections, sectionAliases.primaryTargetUsers) ?? '',
        valueProposition: getSectionByAliases(sections, sectionAliases.valueProposition) ?? '',
        successCriteria: getSuccessCriteriaItems(
          getSectionByAliases(sections, sectionAliases.successCriteria) ?? ''
        ),
        constraints: getSectionByAliases(sections, sectionAliases.constraints) ?? '',
        nonGoals: getSectionByAliases(sections, sectionAliases.nonGoals) ?? '',
      },
    };

    await saveFinalizedRecordAsync(workspaceRoot, {
      documentRevision: output.documentRevision,
      output,
    });

    return { status: 'ok', data: output };
  }
}

export async function checkBusinessDefinitionAsync(
  workspaceRoot: string,
  minMeaningfulLength = DEFAULT_MIN_MEANINGFUL_LENGTH
): Promise<BusinessDefinitionCheck> {
  const businessPath = path.join(workspaceRoot, ...BUSINESS_PATH);
  const markdown = await readFileSafe(businessPath);
  const unmet: Array<{ code: string; message: string }> = [];
  const findings: BusinessDefinitionCheckFinding[] = [];

  if (!markdown) {
    unmet.push({
      code: 'business_definition_missing',
      message: '.ai-team/business.md does not exist.',
    });
    return { done: false, unmet, findings };
  }

  const meaningfulLength = computeMeaningfulLength(markdown);
  if (meaningfulLength < minMeaningfulLength) {
    unmet.push({
      code: 'business_definition_too_short',
      message: `Business definition length ${meaningfulLength} is below threshold ${minMeaningfulLength}.`,
    });
    findings.push({
      code: 'length_too_short',
      severity: 'blocking',
      message: `Document must reach meaningful length threshold (${minMeaningfulLength}).`,
    });
  }

  const sections = parseSections(markdown);
  const requiredSections: string[] = [];
  for (const [sectionKey, aliases] of Object.entries(sectionAliases)) {
    const content = getSectionByAliases(sections, aliases);
    if (!content) {
      unmet.push({
        code: `${sectionKey}_missing`,
        message: `Required section is missing: ${aliases[0]}.`,
      });
      findings.push({
        code: `${sectionKey}_missing`,
        severity: 'blocking',
        message: `Required section "${aliases[0]}" is missing.`,
        section: aliases[0],
      });
      continue;
    }
    requiredSections.push(aliases[0]);
    if (!isSectionNonTrivial(content)) {
      unmet.push({
        code: `${sectionKey}_trivial`,
        message: `Section "${aliases[0]}" must contain non-trivial content.`,
      });
      findings.push({
        code: `${sectionKey}_trivial`,
        severity: 'blocking',
        message: `Section "${aliases[0]}" appears trivial or placeholder-like.`,
        section: aliases[0],
      });
    }
  }

  const successCriteriaSection = getSectionByAliases(sections, sectionAliases.successCriteria);
  const measurableCriteria = getMeasurableSuccessCriteriaCount(successCriteriaSection ?? '');
  if (measurableCriteria < 3) {
    unmet.push({
      code: 'success_criteria_insufficient',
      message: `At least three measurable success criteria are required (found ${measurableCriteria}).`,
    });
    findings.push({
      code: 'success_criteria_insufficient',
      severity: 'blocking',
      message: 'At least three measurable success criteria are required.',
      section: sectionAliases.successCriteria[0],
    });
  }

  const documentRevision = computeRevision(markdown);
  const approval = await loadApprovalRecordAsync(workspaceRoot);
  if (!approval) {
    unmet.push({
      code: 'approval_missing',
      message: 'Developer approval for the current business definition revision is missing.',
    });
    findings.push({
      code: 'approval_missing',
      severity: 'blocking',
      message: 'Explicit developer approval is required.',
    });
  } else {
    if (approval.documentRevision !== documentRevision) {
      unmet.push({
        code: 'approval_stale',
        message: 'Developer approval is stale due to material document revision changes.',
      });
      findings.push({
        code: 'approval_stale',
        severity: 'blocking',
        message: 'Approval must be recaptured after material document changes.',
      });
    }

    const fileInfo = await stat(businessPath);
    const updatedAt = fileInfo.mtime.toISOString();
    if (approval.approvalTimestamp < updatedAt) {
      unmet.push({
        code: 'approval_precedes_latest_revision',
        message: 'Approval timestamp precedes the latest business definition update.',
      });
      findings.push({
        code: 'approval_precedes_latest_revision',
        severity: 'blocking',
        message: 'Approval must occur after the latest material update.',
      });
    }
  }

  const done = unmet.length === 0;
  return {
    done,
    unmet,
    findings,
    ...(done && approval
      ? {
          evidence: {
            documentPath: '.ai-team/business.md',
            documentRevision,
            meaningfulLength,
            requiredSections,
            approvalMessageId: approval.approvalMessageId,
            approvalTimestamp: approval.approvalTimestamp,
            evaluationRevision: documentRevision,
          },
        }
      : {}),
  };
}

function parseSections(markdown: string): Record<string, string> {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const sections: Record<string, string[]> = {};
  let currentHeading = '__root__';
  sections[currentHeading] = [];
  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      currentHeading = normalizeHeading(headingMatch[2]);
      sections[currentHeading] ??= [];
      continue;
    }
    sections[currentHeading]?.push(line);
  }
  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(sections)) {
    mapped[key] = value.join('\n').trim();
  }
  return mapped;
}

function getSectionByAliases(
  sections: Record<string, string>,
  aliases: readonly string[]
): string | undefined {
  for (const alias of aliases) {
    const normalized = normalizeHeading(alias);
    const content = sections[normalized];
    if (content && content.trim().length > 0) {
      return content.trim();
    }
  }
  return undefined;
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, '')
    .replaceAll(/\s+/g, ' ');
}

function isSectionNonTrivial(content: string): boolean {
  if (computeMeaningfulLength(content) < MIN_SECTION_MEANINGFUL_LENGTH) return false;
  const collapsed = content.replaceAll(/\s+/g, ' ').trim();
  return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(collapsed));
}

function computeMeaningfulLength(content: string): number {
  const normalized = content
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/`[^`]*`/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return normalized.length;
}

function computeRevision(content: string): string {
  const normalized = content.replaceAll('\r\n', '\n').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function getSuccessCriteriaItems(sectionContent: string): string[] {
  const bulletItems = sectionContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
  if (bulletItems.length > 0) return bulletItems;
  return sectionContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function getMeasurableSuccessCriteriaCount(sectionContent: string): number {
  return getSuccessCriteriaItems(sectionContent).filter((item) => isMeasurableCriterion(item)).length;
}

function isMeasurableCriterion(value: string): boolean {
  return /(\d|%|within|under|less than|more than|at least|reduce|increase|decrease|target)/i.test(
    value
  );
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

function parseApprovalRecord(raw: string, sourcePath: string): BusinessDefinitionApprovalRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Approval record at '${sourcePath}' is not valid JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Approval record at '${sourcePath}' must be an object.`);
  }

  const record = parsed as Partial<BusinessDefinitionApprovalRecord>;
  if (
    typeof record.documentRevision !== 'string' ||
    typeof record.approvalMessageId !== 'string' ||
    typeof record.approvalTimestamp !== 'string' ||
    typeof record.capturedAt !== 'string'
  ) {
    throw new Error(
      `Approval record at '${sourcePath}' must include documentRevision, approvalMessageId, approvalTimestamp, and capturedAt.`
    );
  }
  return record as BusinessDefinitionApprovalRecord;
}

function parseFinalizedRecord(raw: string, sourcePath: string): BusinessDefinitionFinalizedRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Finalized record at '${sourcePath}' is not valid JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Finalized record at '${sourcePath}' must be an object.`);
  }

  const record = parsed as Partial<BusinessDefinitionFinalizedRecord>;
  if (
    typeof record.documentRevision !== 'string' ||
    !record.output ||
    typeof record.output !== 'object'
  ) {
    throw new Error(`Finalized record at '${sourcePath}' must include documentRevision and output.`);
  }
  return record as BusinessDefinitionFinalizedRecord;
}

async function loadApprovalRecordAsync(
  workspaceRoot: string
): Promise<BusinessDefinitionApprovalRecord | undefined> {
  const filePath = path.join(workspaceRoot, ...APPROVAL_PATH);
  const raw = await readFileSafe(filePath);
  if (!raw) return undefined;
  return parseApprovalRecord(raw, filePath);
}

async function saveApprovalRecordAsync(
  workspaceRoot: string,
  approval: BusinessDefinitionApprovalRecord
): Promise<void> {
  const filePath = path.join(workspaceRoot, ...APPROVAL_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(approval, null, 2), 'utf8');
}

async function loadFinalizedRecordAsync(
  workspaceRoot: string
): Promise<BusinessDefinitionFinalizedRecord | undefined> {
  const filePath = path.join(workspaceRoot, ...FINALIZER_PATH);
  const raw = await readFileSafe(filePath);
  if (!raw) return undefined;
  return parseFinalizedRecord(raw, filePath);
}

async function saveFinalizedRecordAsync(
  workspaceRoot: string,
  record: BusinessDefinitionFinalizedRecord
): Promise<void> {
  const filePath = path.join(workspaceRoot, ...FINALIZER_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}

function resolveApprovalMessage(
  ctx: ExecutionContext,
  messageId: string | undefined,
  timestamp: string | undefined
): { id: string; timestamp: string; content: string } | undefined {
  const visibleHumanMessages = [...ctx.history]
    .filter((message) => message.isHuman && !message.hiddenFromLlm)
    .reverse();

  const selected =
    messageId || timestamp
      ? visibleHumanMessages.find(
          (message) =>
            (messageId ? String(message.id ?? '') === messageId : true) &&
            (timestamp ? message.timestamp === timestamp : true)
        )
      : visibleHumanMessages[0];
  if (!selected) return undefined;
  return {
    id: messageId ?? String(selected.id ?? `message-${selected.timestamp}`),
    timestamp: timestamp ?? selected.timestamp,
    content: selected.content,
  };
}

function isExplicitApprovalMessage(content: string): boolean {
  return /\b(i approve|approved|looks good to me|ship it|proceed with this|this is approved)\b/i.test(
    content
  );
}
