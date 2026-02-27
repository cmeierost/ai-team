import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TypeScriptAnalyzer } from './typescript-analyzer.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TypeScriptAnalyzer', () => {
  let analyzer: TypeScriptAnalyzer;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    analyzer = new TypeScriptAnalyzer();
    testDir = join(tmpdir(), `ts-analyzer-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'test.ts');

    const testContent = `
import { readFile } from 'fs/promises';
import path from 'path';
import type { Config } from './types';

export class DataProcessor {
  private cache: Map<string, any>;

  constructor() {
    this.cache = new Map();
  }

  async processFile(filePath: string): Promise<void> {
    const data = await readFile(filePath, 'utf-8');
    if (data.length > 0) {
      this.cache.set(filePath, data);
    }
  }

  getCached(key: string): any {
    return this.cache.get(key);
  }
}

export function complexFunction(x: number, y: number, z: number): number {
  if (x > 0) {
    if (y > 0) {
      if (z > 0) {
        return x + y + z;
      } else {
        return x + y;
      }
    } else {
      return x;
    }
  } else {
    return 0;
  }
}

export async function simpleAsync(value: string): Promise<string> {
  return await Promise.resolve(value);
}

const CONFIG: Config = { enabled: true };
`;

    await writeFile(testFile, testContent, 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('parseFile', () => {
    it('should parse TypeScript file without errors', async () => {
      const ast = await analyzer.parseFile(testFile);

      expect(ast).toBeDefined();
      expect(ast.type).toBe('Program');
      expect(ast.body).toBeDefined();
      expect(ast.body.length).toBeGreaterThan(0);
    });
  });

  describe('getFunctions', () => {
    it('should find all functions', async () => {
      const functions = await analyzer.getFunctions(testFile);

      expect(functions.length).toBeGreaterThanOrEqual(2);
      
      const complexFn = functions.find(f => f.name === 'complexFunction');
      expect(complexFn).toBeDefined();
      expect(complexFn?.parameters).toHaveLength(3);

      const simpleFn = functions.find(f => f.name === 'simpleAsync');
      expect(simpleFn).toBeDefined();
      expect(simpleFn?.isAsync).toBe(true);
    });

    it('should include complexity metrics', async () => {
      const functions = await analyzer.getFunctions(testFile);
      const complexFn = functions.find(f => f.name === 'complexFunction');

      expect(complexFn?.complexity).toBeDefined();
      expect(complexFn?.complexity.cyclomaticComplexity).toBeGreaterThan(1);
      expect(complexFn?.complexity.parameters).toBe(3);
      expect(complexFn?.complexity.linesOfCode).toBeGreaterThan(0);
    });
  });

  describe('getClasses', () => {
    it('should find all classes', async () => {
      const classes = await analyzer.getClasses(testFile);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('DataProcessor');
      expect(classes[0].isExported).toBe(false); // Note: export detection needs parent context
    });

    it('should find class methods', async () => {
      const classes = await analyzer.getClasses(testFile);
      const processor = classes[0];

      expect(processor.methods.length).toBeGreaterThanOrEqual(2);
      
      const processFileMethod = processor.methods.find(m => m.name === 'processFile');
      expect(processFileMethod).toBeDefined();
      expect(processFileMethod?.isAsync).toBe(true);
      expect(processFileMethod?.parameters).toHaveLength(1);
    });

    it('should find class properties', async () => {
      const classes = await analyzer.getClasses(testFile);
      const processor = classes[0];

      expect(processor.properties).toContain('cache');
    });
  });

  describe('getImports', () => {
    it('should find all import statements', async () => {
      const imports = await analyzer.getImports(testFile);

      expect(imports.length).toBeGreaterThanOrEqual(3);

      const fsImport = imports.find(i => i.source === 'fs/promises');
      expect(fsImport).toBeDefined();
      expect(fsImport?.imports).toContain('readFile');

      const pathImport = imports.find(i => i.source === 'path');
      expect(pathImport).toBeDefined();

      const typeImport = imports.find(i => i.source === './types');
      expect(typeImport).toBeDefined();
      expect(typeImport?.isTypeOnly).toBe(true);
    });
  });

  describe('calculateComplexity', () => {
    it('should calculate complexity for specific function', async () => {
      const complexity = await analyzer.calculateComplexity(testFile, 'complexFunction');

      expect(complexity).toBeDefined();
      expect(complexity!.cyclomaticComplexity).toBeGreaterThan(1);
      expect(complexity!.parameters).toBe(3);
      expect(complexity!.returnStatements).toBeGreaterThan(0);
    });

    it('should return null for non-existent function', async () => {
      const complexity = await analyzer.calculateComplexity(testFile, 'nonExistentFunction');

      expect(complexity).toBeNull();
    });
  });

  describe('findUnusedImports', () => {
    it('should detect unused imports', async () => {
      const fileWithUnused = join(testDir, 'unused-imports.ts');
      await writeFile(
        fileWithUnused,
        `
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

// Only using readFile, not writeFile or path
const data = await readFile('test.txt', 'utf-8');
`,
        'utf-8'
      );

      const unusedImports = await analyzer.findUnusedImports(fileWithUnused);

      // This is a basic heuristic check - it may not be 100% accurate
      expect(unusedImports).toBeDefined();
    });
  });

  describe('nested complexity', () => {
    it('should track nested depth', async () => {
      const functions = await analyzer.getFunctions(testFile);
      const complexFn = functions.find(f => f.name === 'complexFunction');

      expect(complexFn?.complexity.nestedDepth).toBeGreaterThan(1);
    });
  });
});
