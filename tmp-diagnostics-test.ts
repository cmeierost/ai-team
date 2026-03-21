// Temporary file for testing post-edit LSP diagnostics

// 1. Type error: string assigned to number
const count: number = 20304;

// 2. Unused variable (warning)
const unused = 42;

// 3. Missing import
import { NonExistent } from './packages/core/src/index.js';

// 4. Property access on wrong type
const obj: { name: string } = { name: 'test' };
const val: number = obj.name;

// 5. Unreachable code
function demo(): string {
  return 'done';
  console.log('unreachable');
}
