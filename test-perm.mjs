import { resolveContext } from './fs-context/dist/permission/resolver.js';
import { parsePermFile } from './fs-context/dist/permission/parser.js';

const perm = parsePermFile('[write]\n.ai-team/tasks/**/*');
const globalFiles = new Set(['.ai-team/tasks/foo.md', '.ai-team/tasks/bar/baz.txt', '.ai-team/AGENTS.md']);
const res = resolveContext(perm, { files: globalFiles }, globalFiles);

console.log('Write:', Array.from(res.write));
console.log('Read:', Array.from(res.read));
