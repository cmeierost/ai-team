import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApproveBusinessDefinitionCommand,
  CheckBusinessDefinitionCommand,
  FinalizeBusinessDefinitionCommand,
} from './business-definition.tool.js';

const VALID_BUSINESS_MARKDOWN = `# Business Definition

## Problem Statement
Our target users currently rely on fragmented spreadsheets and ad hoc messaging to coordinate procurement and delivery decisions. This causes slow turnaround, repeated rework, and inconsistent visibility across teams when priorities change during active projects.

## Primary Target Users
Primary users are operations managers and procurement coordinators in mid-sized manufacturing organizations who must align demand, supplier commitments, and delivery windows while handling frequent requirement changes.

## Value Proposition
We provide a shared decision workspace that turns disconnected updates into one auditable workflow for planning and execution, reducing coordination overhead and making trade-offs visible early enough to avoid costly delays.

## Success Criteria
- Reduce cycle time for cross-team planning decisions by 30% within 90 days.
- Reach at least 85% weekly active usage among target operations users by the end of quarter one.
- Keep confirmed supplier commitment changes reflected in the system within 24 hours for at least 95% of cases.

## Constraints and Non-Goals
Constraints: The first release must integrate with existing ERP exports and avoid introducing a mandatory new identity provider. The team has two engineers for onboarding automation in the initial phase.
Non-goals: We are not replacing ERP systems, implementing full financial forecasting, or introducing custom ML recommendation engines in this phase.
`;

describe('business-definition workflow tools', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function createWorkspace(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'business-definition-tool-'));
    tempRoots.push(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, '.ai-team'), { recursive: true });
    return workspaceRoot;
  }

  async function writeBusinessDocument(workspaceRoot: string, content = VALID_BUSINESS_MARKDOWN): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, '.ai-team', 'business.md'), content, 'utf8');
  }

  function createExecutionContext(
    content: string,
    messageId = '123',
    timestamp = new Date(Date.now() + 60_000).toISOString()
  ) {
    return {
      history: [
        {
          id: Number(messageId),
          isHuman: true,
          timestamp,
          content,
        },
      ],
      invocationSurface: 'chat',
    } as any;
  }

  it('reports missing artifact/sections with blocking findings', async () => {
    const workspaceRoot = await createWorkspace();
    await writeBusinessDocument(
      workspaceRoot,
      '# Business Definition\n\n## Problem Statement\nToo short.\n\n## Success Criteria\n- Improve things.\n'
    );

    const checkCommand = new CheckBusinessDefinitionCommand(workspaceRoot);
    const response = await checkCommand.execute({}, createExecutionContext('I approve this.') as any);
    expect(response.status).toBe('ok');
    expect(response.data?.done).toBe(false);
    expect(response.data?.unmet.map((entry) => entry.code)).toContain('business_definition_too_short');
    expect(response.data?.findings.some((finding) => finding.severity === 'blocking')).toBe(true);
  });

  it('captures explicit approval and validates a complete document revision', async () => {
    const workspaceRoot = await createWorkspace();
    await writeBusinessDocument(workspaceRoot);

    const approveCommand = new ApproveBusinessDefinitionCommand(workspaceRoot);
    const approveResponse = await approveCommand.execute(
      {},
      createExecutionContext('I approve this business definition and want to proceed.')
    );
    expect(approveResponse.status).toBe('ok');
    expect(approveResponse.data?.approvalMessageId).toBe('123');

    const checkCommand = new CheckBusinessDefinitionCommand(workspaceRoot);
    const checkResponse = await checkCommand.execute({}, createExecutionContext('irrelevant'));
    expect(checkResponse.status).toBe('ok');
    expect(checkResponse.data?.done).toBe(true);
    expect(checkResponse.data?.evidence?.approvalMessageId).toBe('123');
    expect(checkResponse.data?.evidence?.documentPath).toBe('.ai-team/business.md');
  });

  it('invalidates prior approval when the business document revision changes', async () => {
    const workspaceRoot = await createWorkspace();
    await writeBusinessDocument(workspaceRoot);

    const approveCommand = new ApproveBusinessDefinitionCommand(workspaceRoot);
    await approveCommand.execute({}, createExecutionContext('I approve this business definition.'));

    await fs.appendFile(
      path.join(workspaceRoot, '.ai-team', 'business.md'),
      '\n\nAdditional strategic decision details for a revised scope.\n',
      'utf8'
    );

    const checkCommand = new CheckBusinessDefinitionCommand(workspaceRoot);
    const checkResponse = await checkCommand.execute({}, createExecutionContext('irrelevant'));
    expect(checkResponse.status).toBe('ok');
    expect(checkResponse.data?.done).toBe(false);
    expect(checkResponse.data?.unmet.map((entry) => entry.code)).toContain('approval_stale');
  });

  it('finalizes idempotently for the same approved revision', async () => {
    const workspaceRoot = await createWorkspace();
    await writeBusinessDocument(workspaceRoot);

    const approveCommand = new ApproveBusinessDefinitionCommand(workspaceRoot);
    await approveCommand.execute({}, createExecutionContext('This is approved. Please continue.'));

    const finalizeCommand = new FinalizeBusinessDefinitionCommand(workspaceRoot);
    const first = await finalizeCommand.execute({}, createExecutionContext('unused'));
    const second = await finalizeCommand.execute({}, createExecutionContext('unused'));

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(first.data).toEqual(second.data);
    expect(first.data?.summary.successCriteria.length).toBeGreaterThanOrEqual(3);
  });
});
