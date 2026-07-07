import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentNotFoundError, AmbiguousAgentQueryError } from '@ai-team/core';
import { PermFileRegistry } from 'fs-context';
import { AgentManager } from './agent-manager.js';
import { AgentDocumentStorage } from './agent-document-storage.js';
import { MarkdownSectionService } from './markdown-service.js';
import { WorkspaceDiscoveryStorage } from './workspace-discovery-storage.js';
import { WorkspaceStorage } from './workspace-storage.js';

const createdDirs: string[] = [];

function createTestAgentManager(workspaceRoot: string): AgentManager {
  return new AgentManager(
    workspaceRoot,
    new AgentDocumentStorage(
      workspaceRoot,
      new MarkdownSectionService(),
      new WorkspaceStorage(),
      new WorkspaceDiscoveryStorage()
    ),
    new WorkspaceStorage(),
    new WorkspaceDiscoveryStorage(),
    new PermFileRegistry(workspaceRoot)
  );
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-agent-'));
  createdDirs.push(dir);
  return dir;
}

async function writeAgentMd(
  root: string,
  id: string,
  frontmatter: string,
  body = ''
): Promise<void> {
  const absolutePath = path.join(root, `.ai-team/agents/${id}.agent.md`);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const content = `---\n${frontmatter}\n---\n${body}`;
  await fs.writeFile(absolutePath, content, 'utf-8');
}

afterEach(async () => {
  await Promise.all(
    createdDirs
      .splice(0, createdDirs.length)
      .map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('AgentManager syncHandoffs', () => {
  it('generates upward and downward auto-handoffs on load', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'ceo', 'name: CEO\nrole: chief\ncontextLevel: organization');
    await writeAgentMd(
      root,
      'lead',
      'name: Lead\nrole: team-lead\ncontextLevel: feature\nreportsTo: ceo'
    );

    const mgr = createTestAgentManager(root);

    const ceo = (await mgr.getAgentAsync('ceo'))!;
    const lead = (await mgr.getAgentAsync('lead'))!;

    // Lead has upward handoff to CEO
    expect(lead.handoffs?.some((h) => h.agent === 'ceo' && h.label.startsWith('[auto]'))).toBe(
      true
    );
    // CEO has downward handoff to Lead
    expect(ceo.handoffs?.some((h) => h.agent === 'lead' && h.label.startsWith('[auto]'))).toBe(
      true
    );
  });

  it('cascades handoff resync to old and new boss on reportsTo change', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'alice', 'name: Alice\nrole: boss-a\ncontextLevel: feature');
    await writeAgentMd(root, 'bob', 'name: Bob\nrole: boss-b\ncontextLevel: feature');
    await writeAgentMd(
      root,
      'charlie',
      'name: Charlie\nrole: worker\ncontextLevel: task\nreportsTo: alice'
    );

    const mgr = createTestAgentManager(root);

    const alice = (await mgr.getAgentAsync('alice'))!;
    const bob = (await mgr.getAgentAsync('bob'))!;
    const charlie = (await mgr.getAgentAsync('charlie'))!;

    // Before: Alice has downward handoff to Charlie
    expect(alice.handoffs?.some((h) => h.agent === 'charlie')).toBe(true);
    // Before: Bob has no downward handoff to Charlie
    expect(bob.handoffs?.some((h) => h.agent === 'charlie')).toBe(false);

    // Move Charlie from Alice → Bob
    await mgr.updateAgentAsync('charlie', { reportsTo: 'bob' });

    // Charlie's upward handoff now points to Bob
    expect(charlie.handoffs?.some((h) => h.agent === 'bob' && h.label.startsWith('[auto]'))).toBe(
      true
    );
    expect(charlie.handoffs?.some((h) => h.agent === 'alice')).toBe(false);

    // Alice no longer has downward handoff to Charlie
    expect(alice.handoffs?.some((h) => h.agent === 'charlie')).toBe(false);

    // Bob now has downward handoff to Charlie
    expect(bob.handoffs?.some((h) => h.agent === 'charlie' && h.label.startsWith('[auto]'))).toBe(
      true
    );
  });

  it('preserves manual handoffs during resync', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'boss', 'name: Boss\nrole: boss\ncontextLevel: feature');
    await writeAgentMd(
      root,
      'worker',
      [
        'name: Worker',
        'role: IC',
        'contextLevel: task',
        'reportsTo: boss',
        'handoffs:',
        '  - label: "Custom handoff"',
        '    agent: boss',
        '    prompt: "my custom prompt"',
      ].join('\n')
    );

    const mgr = createTestAgentManager(root);

    const worker = (await mgr.getAgentAsync('worker'))!;
    const manual = worker.handoffs?.filter((h) => !h.label.startsWith('[auto]'));
    const auto = worker.handoffs?.filter((h) => h.label.startsWith('[auto]'));

    expect(manual).toHaveLength(1);
    expect(manual![0].label).toBe('Custom handoff');
    expect(auto!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('AgentManager resolveAgentForOperationAsync', () => {
  it('returns id/name/role for a single match', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'michael-brown', 'name: Michael Brown\nrole: cto\ncontextLevel: organization');

    const mgr = createTestAgentManager(root);
    const result = await mgr.resolveAgentForOperationAsync('cto', 'test operation');

    expect(result).toEqual({
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'cto',
    });
  });

  it('throws AgentNotFoundError with operation context when no match exists', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'michael-brown', 'name: Michael Brown\nrole: cto\ncontextLevel: organization');

    const mgr = createTestAgentManager(root);

    await expect(mgr.resolveAgentForOperationAsync('unknown-agent', 'list sessions')).rejects.toThrow(
      AgentNotFoundError
    );
    await expect(mgr.resolveAgentForOperationAsync('unknown-agent', 'list sessions')).rejects.toThrow(
      /Cannot list sessions/
    );
  });

  it('throws AmbiguousAgentQueryError when query matches multiple agents', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'dev-a', 'name: Dev A\nrole: developer\ncontextLevel: feature');
    await writeAgentMd(root, 'dev-b', 'name: Dev B\nrole: developer\ncontextLevel: feature');

    const mgr = createTestAgentManager(root);

    await expect(mgr.resolveAgentForOperationAsync('developer', 'delegate task')).rejects.toThrow(
      AmbiguousAgentQueryError
    );
  });
});

describe('AgentManager resolveAgentSafeAsync', () => {
  it('returns a resolved summary for a unique match', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'sarah-lee', 'name: Sarah Lee\nrole: chief-architect\ncontextLevel: organization');

    const mgr = createTestAgentManager(root);
    const result = await mgr.resolveAgentSafeAsync('sarah');

    expect(result).toEqual({
      id: 'sarah-lee',
      name: 'Sarah Lee',
      role: 'chief-architect',
    });
  });

  it('returns null when no match exists', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'sarah-lee', 'name: Sarah Lee\nrole: chief-architect\ncontextLevel: organization');

    const mgr = createTestAgentManager(root);
    await expect(mgr.resolveAgentSafeAsync('missing')).resolves.toBeNull();
  });

  it('returns null when query is ambiguous', async () => {
    const root = await createWorkspace();
    await writeAgentMd(root, 'dev-a', 'name: Dev A\nrole: developer\ncontextLevel: feature');
    await writeAgentMd(root, 'dev-b', 'name: Dev B\nrole: developer\ncontextLevel: feature');

    const mgr = createTestAgentManager(root);
    await expect(mgr.resolveAgentSafeAsync('developer')).resolves.toBeNull();
  });
});
