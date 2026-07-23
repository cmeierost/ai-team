import * as fs from 'node:fs';

const files = [
  'packages/cli/src/tui/agent-response.ts',
  'packages/cli/src/tui/chat-view.ts',
  'packages/cli/src/tui/chat-viewport.ts',
  'packages/cli/src/tui/code-edit-proposal.ts',
  'packages/cli/src/tui/handoff-transition.ts',
  'packages/cli/src/tui/header-bar.ts',
  'packages/cli/src/tui/previous-log.ts',
  'packages/cli/src/tui/status-line.ts',
  'packages/cli/src/tui/tool-event.ts',
  'packages/cli/src/tui/view-stack-renderer.ts',
];

const removeMethod = `  remove(): void {
    const parent = this._parent;
    if (parent) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
      this._parent = null;
    }
  }

`;

for (const f of files) {
  const path = `c:/Projects/ai-team/${f}`;
  let content = fs.readFileSync(path, 'utf8');
  if (!content.includes('remove(): void')) {
    content = content.replace('  invalidate(): void {', removeMethod + '  invalidate(): void {');
    fs.writeFileSync(path, content);
    console.log(`Updated: ${f}`);
  } else {
    console.log(`Skipped (already has remove): ${f}`);
  }
}
console.log('done');
