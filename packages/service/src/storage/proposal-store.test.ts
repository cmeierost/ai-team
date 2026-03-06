import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProposalStore, type StoredProposal } from './proposal-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-proposals-test-'));
  tempDirs.push(dir);
  return dir;
}

function makeProposal(overrides: Partial<StoredProposal> = {}): StoredProposal {
  return {
    proposalId: 'proposal-abc-123',
    agentName: 'alex-morgan',
    description: 'Update bio section',
    createdAt: '2026-03-05T10:00:00.000Z',
    files: [
      {
        filePath: '/workspace/agents/alex-morgan.md',
        oldContent: '# Alex\n\nOld bio.',
        newContent: '# Alex\n\nNew bio.',
        additions: 1,
        deletions: 1,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe('ProposalStore.save', () => {
  let store: ProposalStore;
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = createTempWorkspace();
    store = new ProposalStore(workspaceRoot);
  });

  it('creates the proposals directory if it does not exist', () => {
    const proposal = makeProposal();
    store.save(proposal);

    const dir = path.join(workspaceRoot, '.ai-team', 'proposals');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('writes a JSON file named <proposalId>.json', () => {
    const proposal = makeProposal();
    store.save(proposal);

    const file = path.join(workspaceRoot, '.ai-team', 'proposals', 'proposal-abc-123.json');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('serialises all proposal fields correctly', () => {
    const proposal = makeProposal();
    store.save(proposal);

    const file = path.join(workspaceRoot, '.ai-team', 'proposals', 'proposal-abc-123.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredProposal;

    expect(parsed.proposalId).toBe(proposal.proposalId);
    expect(parsed.agentName).toBe(proposal.agentName);
    expect(parsed.description).toBe(proposal.description);
    expect(parsed.createdAt).toBe(proposal.createdAt);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].oldContent).toBe('# Alex\n\nOld bio.');
    expect(parsed.files[0].newContent).toBe('# Alex\n\nNew bio.');
  });

  it('overwrites an existing file when saving the same proposalId again', () => {
    const original = makeProposal({ description: 'First save' });
    const updated = makeProposal({ description: 'Second save' });

    store.save(original);
    store.save(updated);

    const file = path.join(workspaceRoot, '.ai-team', 'proposals', 'proposal-abc-123.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredProposal;
    expect(parsed.description).toBe('Second save');
  });

  it('can save multiple proposals with different IDs simultaneously', () => {
    store.save(makeProposal({ proposalId: 'p-1' }));
    store.save(makeProposal({ proposalId: 'p-2' }));
    store.save(makeProposal({ proposalId: 'p-3' }));

    const dir = path.join(workspaceRoot, '.ai-team', 'proposals');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(3);
    expect(files.sort()).toEqual(['p-1.json', 'p-2.json', 'p-3.json']);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ProposalStore.delete', () => {
  let store: ProposalStore;

  beforeEach(() => {
    store = new ProposalStore(createTempWorkspace());
  });

  it('removes the proposal file from disk', () => {
    const proposal = makeProposal();
    store.save(proposal);
    store.delete(proposal.proposalId);

    const file = path.join(
      (store as any).dir,
      `${proposal.proposalId}.json`,
    );
    expect(fs.existsSync(file)).toBe(false);
  });

  it('does not throw when deleting a non-existent proposal (ENOENT)', () => {
    expect(() => store.delete('does-not-exist')).not.toThrow();
  });

  it('only removes the targeted proposal, leaving others intact', () => {
    store.save(makeProposal({ proposalId: 'keep-me' }));
    store.save(makeProposal({ proposalId: 'delete-me' }));

    store.delete('delete-me');

    const remaining = store.loadAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].proposalId).toBe('keep-me');
  });
});

// ---------------------------------------------------------------------------
// loadAll
// ---------------------------------------------------------------------------

describe('ProposalStore.loadAll', () => {
  let store: ProposalStore;

  beforeEach(() => {
    store = new ProposalStore(createTempWorkspace());
  });

  it('returns an empty array when the proposals directory does not exist', () => {
    expect(store.loadAll()).toEqual([]);
  });

  it('returns an empty array when the directory exists but is empty', () => {
    fs.mkdirSync(path.join((store as any).dir), { recursive: true });
    expect(store.loadAll()).toEqual([]);
  });

  it('returns all saved proposals', () => {
    store.save(makeProposal({ proposalId: 'p-1' }));
    store.save(makeProposal({ proposalId: 'p-2' }));

    const all = store.loadAll();
    expect(all).toHaveLength(2);
    const ids = all.map(p => p.proposalId).sort();
    expect(ids).toEqual(['p-1', 'p-2']);
  });

  it('skips corrupt/non-JSON files without throwing', () => {
    fs.mkdirSync(path.join((store as any).dir), { recursive: true });
    fs.writeFileSync(path.join((store as any).dir, 'corrupt.json'), 'not-json', 'utf8');
    store.save(makeProposal({ proposalId: 'valid-one' }));

    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].proposalId).toBe('valid-one');
  });

  it('ignores non-.json files in the directory', () => {
    fs.mkdirSync(path.join((store as any).dir), { recursive: true });
    fs.writeFileSync(path.join((store as any).dir, 'readme.txt'), 'hello', 'utf8');
    store.save(makeProposal({ proposalId: 'p-1' }));

    const all = store.loadAll();
    expect(all).toHaveLength(1);
  });

  it('preserves oldContent and newContent faithfully (used for undo and diff)', () => {
    const proposal = makeProposal({
      files: [
        {
          filePath: '/workspace/src/index.ts',
          oldContent: 'const x = 1;',
          newContent: 'const x = 42;',
          additions: 1,
          deletions: 1,
        },
      ],
    });
    store.save(proposal);

    const [loaded] = store.loadAll();
    expect(loaded.files[0].oldContent).toBe('const x = 1;');
    expect(loaded.files[0].newContent).toBe('const x = 42;');
  });
});

// ---------------------------------------------------------------------------
// load (single)
// ---------------------------------------------------------------------------

describe('ProposalStore.load', () => {
  let store: ProposalStore;

  beforeEach(() => {
    store = new ProposalStore(createTempWorkspace());
  });

  it('returns the proposal when it exists', () => {
    const proposal = makeProposal();
    store.save(proposal);

    const loaded = store.load(proposal.proposalId);
    expect(loaded).not.toBeNull();
    expect(loaded!.proposalId).toBe(proposal.proposalId);
  });

  it('returns null for a non-existent proposalId', () => {
    expect(store.load('ghost-id')).toBeNull();
  });

  it('returns null for a corrupt file', () => {
    fs.mkdirSync(path.join((store as any).dir), { recursive: true });
    fs.writeFileSync(path.join((store as any).dir, 'bad.json'), '{broken', 'utf8');

    expect(store.load('bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// round-trip
// ---------------------------------------------------------------------------

describe('ProposalStore round-trip', () => {
  it('save → loadAll → delete lifecycle works end-to-end', () => {
    const workspaceRoot = createTempWorkspace();
    const store = new ProposalStore(workspaceRoot);

    // Nothing pending initially
    expect(store.loadAll()).toHaveLength(0);

    // Save two proposals
    store.save(makeProposal({ proposalId: 'r-1', description: 'First' }));
    store.save(makeProposal({ proposalId: 'r-2', description: 'Second' }));
    expect(store.loadAll()).toHaveLength(2);

    // Accept r-1 (user clicks Keep)
    store.delete('r-1');
    const remaining = store.loadAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].proposalId).toBe('r-2');

    // Reject r-2 (user clicks Undo)
    store.delete('r-2');
    expect(store.loadAll()).toHaveLength(0);
  });

  it('a fresh ProposalStore on same workspaceRoot sees previously persisted proposals', () => {
    const workspaceRoot = createTempWorkspace();

    // Simulate api-server writing the proposal
    const storeA = new ProposalStore(workspaceRoot);
    storeA.save(makeProposal({ proposalId: 'persisted-1' }));

    // Simulate IDE reconnect: new ProposalStore instance reads from disk
    const storeB = new ProposalStore(workspaceRoot);
    const all = storeB.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].proposalId).toBe('persisted-1');
  });
});
