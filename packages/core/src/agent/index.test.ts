import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentManager } from './index.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-agent-'));
  createdDirs.push(dir);
  return dir;
}

async function writeAgentMd(root: string, id: string, frontmatter: string, body = ''): Promise<void> {
  const absolutePath = path.join(root, `.ai-team/agents/${id}.agent.md`);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const content = `---\n${frontmatter}\n---\n${body}`;
  await fs.writeFile(absolutePath, content, 'utf-8');
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('AgentManager syncHandoffs', () => {
  it('generates upward and downward auto-handoffs on load', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'ceo', 'name: CEO\nrole: chief\ncontextLevel: organization');
    await writeAgentMd(root, 'lead', 'name: Lead\nrole: team-lead\ncontextLevel: feature\nreportsTo: ceo');

    const mgr = new AgentManager(root);
    await mgr.initialize();

    const ceo = mgr.getAgent('ceo')!;
    const lead = mgr.getAgent('lead')!;

    // Lead has upward handoff to CEO
    expect(lead.handoffs?.some(h => h.agent === 'ceo' && h.label.startsWith('[auto]'))).toBe(true);
    // CEO has downward handoff to Lead
    expect(ceo.handoffs?.some(h => h.agent === 'lead' && h.label.startsWith('[auto]'))).toBe(true);
  });

  it('cascades handoff resync to old and new boss on reportsTo change', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'alice', 'name: Alice\nrole: boss-a\ncontextLevel: feature');
    await writeAgentMd(root, 'bob', 'name: Bob\nrole: boss-b\ncontextLevel: feature');
    await writeAgentMd(root, 'charlie', 'name: Charlie\nrole: worker\ncontextLevel: task\nreportsTo: alice');

    const mgr = new AgentManager(root);
    await mgr.initialize();

    // Before: Alice has downward handoff to Charlie
    expect(mgr.getAgent('alice')!.handoffs?.some(h => h.agent === 'charlie')).toBe(true);
    // Before: Bob has no downward handoff to Charlie
    expect(mgr.getAgent('bob')!.handoffs?.some(h => h.agent === 'charlie')).toBe(false);

    // Move Charlie from Alice → Bob
    await mgr.updateAgent('charlie', { reportsTo: 'bob' });

    const alice = mgr.getAgent('alice')!;
    const bob = mgr.getAgent('bob')!;
    const charlie = mgr.getAgent('charlie')!;

    // Charlie's upward handoff now points to Bob
    expect(charlie.handoffs?.some(h => h.agent === 'bob' && h.label.startsWith('[auto]'))).toBe(true);
    expect(charlie.handoffs?.some(h => h.agent === 'alice')).toBe(false);

    // Alice no longer has downward handoff to Charlie
    expect(alice.handoffs?.some(h => h.agent === 'charlie')).toBe(false);

    // Bob now has downward handoff to Charlie
    expect(bob.handoffs?.some(h => h.agent === 'charlie' && h.label.startsWith('[auto]'))).toBe(true);
  });

  it('preserves manual handoffs during resync', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'boss', 'name: Boss\nrole: boss\ncontextLevel: feature');
    await writeAgentMd(root, 'worker', [
      'name: Worker',
      'role: IC',
      'contextLevel: task',
      'reportsTo: boss',
      'handoffs:',
      '  - label: "Custom handoff"',
      '    agent: boss',
      '    prompt: "my custom prompt"',
    ].join('\n'));

    const mgr = new AgentManager(root);
    await mgr.initialize();

    const worker = mgr.getAgent('worker')!;
    const manual = worker.handoffs?.filter(h => !h.label.startsWith('[auto]'));
    const auto = worker.handoffs?.filter(h => h.label.startsWith('[auto]'));

    expect(manual).toHaveLength(1);
    expect(manual![0].label).toBe('Custom handoff');
    expect(auto!.length).toBeGreaterThanOrEqual(1);
  });
});
