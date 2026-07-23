import * as fs from 'node:fs';

const files = [
  'packages/cli/src/tui/agent-response.ts',
  'packages/cli/src/tui/chat-view.ts',
  'packages/cli/src/tui/chat-viewport.ts',
  'packages/cli/src/tui/code-edit-proposal.ts',
  'packages/cli/src/tui/handoff-transition.ts',
  'packages/cli/src/tui/header-bar.ts',
  'packages/cli/src/tui/previous-log.ts',
  'packages/cli/src/tui/prompt.ts',
  'packages/cli/src/tui/status-line.ts',
  'packages/cli/src/tui/tool-event.ts',
  'packages/cli/src/tui/view-stack-renderer.ts',
];

for (const f of files) {
  const path = `c:/Projects/ai-team/${f}`;
  let content = fs.readFileSync(path, 'utf8');
  
  // Add _parent declaration if missing
  if (!content.includes('_parent:')) {
    // Find the class declaration and add _parent after it
    content = content.replace(
      /(export class \w+ implements Component \{)/,
      '$1\n  _parent: import("@ai-team/tui").Container | null = null;'
    );
    fs.writeFileSync(path, content);
    console.log(`Added _parent: ${f}`);
  } else {
    console.log(`Skipped (has _parent): ${f}`);
  }
}
console.log('done');
