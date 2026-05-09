import { Parser, Tree } from 'web-tree-sitter';

/**
 * Language configuration for tree-sitter
 */
export interface LanguageConfig {
  name: string;
  /** Path to WASM grammar file */
  wasmPath: string;
  /** File extensions this language handles */
  extensions: string[];
}

/**
 * Default language configurations for common languages
 */
export const DEFAULT_LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    name: 'typescript',
    wasmPath: 'tree-sitter-typescript.wasm',
    extensions: ['ts', 'tsx'],
  },
  {
    name: 'javascript',
    wasmPath: 'tree-sitter-javascript.wasm',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
  },
  {
    name: 'python',
    wasmPath: 'tree-sitter-python.wasm',
    extensions: ['py'],
  },
  {
    name: 'rust',
    wasmPath: 'tree-sitter-rust.wasm',
    extensions: ['rs'],
  },
  {
    name: 'go',
    wasmPath: 'tree-sitter-go.wasm',
    extensions: ['go'],
  },
  {
    name: 'java',
    wasmPath: 'tree-sitter-java.wasm',
    extensions: ['java'],
  },
  {
    name: 'c',
    wasmPath: 'tree-sitter-c.wasm',
    extensions: ['c', 'h'],
  },
  {
    name: 'cpp',
    wasmPath: 'tree-sitter-cpp.wasm',
    extensions: ['cpp', 'hpp', 'cc', 'cxx'],
  },
];
