#!/usr/bin/env node
/**
 * publish-github.mjs
 *
 * Publishes a clean, history-free snapshot of the current branch to the
 * public GitHub repository (remote: "public", branch: main).
 *
 * What it does:
 *   1. Verifies the "public" remote is configured.
 *   2. Saves the current branch name so it can switch back afterwards.
 *   3. Deletes the local "public-main" branch if it exists.
 *   4. Creates a fresh orphan branch "public-main" from the current working tree.
 *   5. Stages all files and commits with a datestamped message.
 *   6. Force-pushes public-main → main on the "public" remote.
 *   7. Switches back to the original branch.
 *
 * Usage:
 *   node scripts/publish-github.mjs
 *   pnpm publish:github
 *
 * Requirements:
 *   - A git remote named "public" pointing to the GitHub repo.
 *     Set it up once with:
 *       git remote add public https://<token>@github.com/cmeierost/ai-team.git
 *   - You must be on the branch you want to publish (typically "workflow").
 */

import { execSync } from 'node:child_process';

const REMOTE = 'public';
const LOCAL_BRANCH = 'public-main';
const REMOTE_BRANCH = 'main';

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function step(msg) {
  console.log(`\n→ ${msg}`);
}

// Verify remote exists
step(`Checking remote "${REMOTE}"...`);
try {
  const remotes = run('git remote', { silent: true });
  if (
    !remotes
      .split('\n')
      .map((r) => r.trim())
      .includes(REMOTE)
  ) {
    console.error(`✗ Remote "${REMOTE}" not found. Add it with:`);
    console.error(`  git remote add ${REMOTE} https://<token>@github.com/cmeierost/ai-team.git`);
    process.exit(1);
  }
  const url = run(`git remote get-url ${REMOTE}`, { silent: true }).trim();
  console.log(`  ${url}`);
} catch {
  console.error(`✗ Could not read remote "${REMOTE}".`);
  process.exit(1);
}

// Remember current branch
const currentBranch = run('git branch --show-current', { silent: true }).trim();
step(`Current branch: ${currentBranch}`);

// Delete stale local branch if it exists
step(`Removing stale "${LOCAL_BRANCH}" if present...`);
try {
  run(`git branch -D ${LOCAL_BRANCH}`, { silent: true });
  console.log(`  Deleted old ${LOCAL_BRANCH}.`);
} catch {
  console.log(`  (none to remove)`);
}

// Create fresh orphan
step(`Creating orphan branch "${LOCAL_BRANCH}"...`);
run(`git checkout --orphan ${LOCAL_BRANCH}`);

// Stage everything and commit
const date = new Date().toISOString().slice(0, 10);
const message = `Publish ${date}`;
step(`Committing snapshot: "${message}"...`);
run('git add -A');
run(`git commit -m "${message}"`);

// Force-push
step(`Pushing ${LOCAL_BRANCH} → ${REMOTE}/${REMOTE_BRANCH}...`);
run(`git push ${REMOTE} ${LOCAL_BRANCH}:${REMOTE_BRANCH} --force`);

// Switch back
step(`Switching back to "${currentBranch}"...`);
run(`git checkout ${currentBranch}`);

console.log(`\n✓ Published successfully to ${REMOTE}/${REMOTE_BRANCH}.\n`);
