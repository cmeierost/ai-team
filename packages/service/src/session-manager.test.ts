import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from './session-manager.js';
import { SqliteMessageStorage } from './storage/sqlite/sqlite-storage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-sm-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(dir =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

// ---------------------------------------------------------------------------
// findAgentSessionInChain
// ---------------------------------------------------------------------------

describe('SessionManager.findAgentSessionInChain', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    const workspaceRoot = await createTempWorkspace();
    const storage = new SqliteMessageStorage(workspaceRoot);
    // No AgentManager — IDs are used verbatim
    sessionManager = new SessionManager(workspaceRoot, storage);
    await sessionManager.initialize();
  });

  afterEach(async () => {
    await (sessionManager as any).storage.close();
  });

  it('returns the session when the root session belongs to the target agent', async () => {
    // Single session: root belongs to michael
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await sessionManager.findAgentSessionInChain(michaelS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('returns null when the target agent has no session in the chain', async () => {
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const found = await sessionManager.findAgentSessionInChain(michaelS1.id, 'sarah-morgan');
    expect(found).toBeNull();
  });

  it('walks the chain and finds an earlier session for the target agent', async () => {
    // Chain: michaelS1 → alexS1 → michaelS2 (hand back)
    // findAgentSessionInChain(alexS1.id, 'michael-brown') should return michaelS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await sessionManager.findAgentSessionInChain(alexS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds a session two hops back in the chain', async () => {
    // Chain: michaelS1 → alexS1 → sarahS1
    // findAgentSessionInChain(sarahS1.id, 'michael-brown') should return michaelS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await sessionManager.findAgentSessionInChain(sarahS1.id, 'michael-brown');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(michaelS1.id);
  });

  it('finds an intermediate session, not a leaf or root', async () => {
    // Chain: michaelS1 → alexS1 → sarahS1
    // findAgentSessionInChain(sarahS1.id, 'alex-johnson') should return alexS1
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);
    const sarahS1 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', alexS1.id);

    const found = await sessionManager.findAgentSessionInChain(sarahS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });

  it('returns the starting session itself when it belongs to the target agent', async () => {
    // Chain: michaelS1 → alexS1
    // findAgentSessionInChain(alexS1.id, 'alex-johnson') should return alexS1 itself
    const michaelS1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const alexS1 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', michaelS1.id);

    const found = await sessionManager.findAgentSessionInChain(alexS1.id, 'alex-johnson');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(alexS1.id);
  });
});

// ---------------------------------------------------------------------------
// getSessionChain
// ---------------------------------------------------------------------------

describe('SessionManager.getSessionChain', () => {
  let sessionManager: SessionManager;

  beforeEach(async () => {
    const workspaceRoot = await createTempWorkspace();
    const storage = new SqliteMessageStorage(workspaceRoot);
    sessionManager = new SessionManager(workspaceRoot, storage);
    await sessionManager.initialize();
  });

  afterEach(async () => {
    await (sessionManager as any).storage.close();
  });

  it('returns a single-session chain for a root session', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');

    const chain = await sessionManager.getSessionChain(s1.id);
    expect(chain).toHaveLength(1);
    expect(chain[0].id).toBe(s1.id);
  });

  it('returns sessions ordered root → leaf for a two-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);

    const chain = await sessionManager.getSessionChain(s2.id);
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe(s1.id);  // root first
    expect(chain[1].id).toBe(s2.id);  // leaf last
  });

  it('returns sessions ordered root → leaf for a three-session chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    const chain = await sessionManager.getSessionChain(s3.id);
    expect(chain).toHaveLength(3);
    expect(chain[0].id).toBe(s1.id);
    expect(chain[1].id).toBe(s2.id);
    expect(chain[2].id).toBe(s3.id);
  });

  it('can start the walk from any session in the chain', async () => {
    const s1 = await sessionManager.createSession('michael-brown', 'dev-1');
    const s2 = await sessionManager.createHandoffSession('alex-johnson', 'dev-1', s1.id);
    const s3 = await sessionManager.createHandoffSession('sarah-morgan', 'dev-1', s2.id);

    // Starting from the middle session s2 should still walk back to the root
    const chainFromMiddle = await sessionManager.getSessionChain(s2.id);
    expect(chainFromMiddle).toHaveLength(2);
    expect(chainFromMiddle[0].id).toBe(s1.id);
    expect(chainFromMiddle[1].id).toBe(s2.id);

    // s3 is not reachable from s2 (chain walks backward only)
    const ids = chainFromMiddle.map(s => s.id);
    expect(ids).not.toContain(s3.id);
  });
});
