import * as fs from 'node:fs';

const files = [
  'packages/tui/src/components/text.ts',
  'packages/tui/src/components/loader.ts',
  'packages/tui/src/components/spacer.ts',
  'packages/tui/src/components/image.ts',
];

for (const f of files) {
  const path = `c:/Projects/ai-team/${f}`;
  let content = fs.readFileSync(path, 'utf8');
  
  // Add _parent and remove after class declaration
  if (!content.includes('_parent:')) {
    content = content.replace(
      /(export class \w+ implements Component \{)/,
      '$1\n  _parent: import("../component.js").Container | null = null;'
    );
    // Add remove() before invalidate()
    content = content.replace(
      /  invalidate\(\): void \{/g,
      `  remove(): void {
    const parent = this._parent;
    if (parent) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
      this._parent = null;
    }
  }

  invalidate(): void {`
    );
    fs.writeFileSync(path, content);
    console.log(`Updated: ${f}`);
  }
}
console.log('done');
