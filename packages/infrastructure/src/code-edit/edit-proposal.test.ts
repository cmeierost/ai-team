import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProposalValidator,
  ProposalStatus,
  generateProposalId,
  summarizeProposal,
  type CodeEditProposal,
} from './edit-proposal.js';
import { DiffBuilder } from './diff-builder.js';

describe('ProposalValidator', () => {
  let validator: ProposalValidator;

  beforeEach(() => {
    validator = new ProposalValidator();
  });

  describe('validateInput', () => {
    it('should validate correct input', () => {
      const input = {
        description: 'Fix typo',
        changes: [
          {
            filePath: 'test.ts',
            oldContent: 'old',
            newContent: 'new',
          },
        ],
      };

      const result = validator.validateInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject input without description', () => {
      const input = {
        changes: [
          {
            filePath: 'test.ts',
            oldContent: 'old',
            newContent: 'new',
          },
        ],
      };

      const result = validator.validateInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('description');
    });

    it('should reject input without changes', () => {
      const input = {
        description: 'Fix typo',
        changes: [],
      };

      const result = validator.validateInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject change without filename', () => {
      const input = {
        description: 'Fix typo',
        changes: [
          {
            filePath: '',
            oldContent: 'old',
            newContent: 'new',
          },
        ],
      };

      const result = validator.validateInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateConstraints', () => {
    let diffBuilder: DiffBuilder;

    beforeEach(() => {
      diffBuilder = new DiffBuilder();
    });

    it('should pass for reasonable proposal', () => {
      const proposal: CodeEditProposal = {
        id: 'test-1',
        agentName: 'test-agent',
        timestamp: new Date(),
        description: 'Simple change',
        changes: [
          {
            filePath: 'test.ts',
            oldContent: 'old',
            newContent: 'new',
            diff: diffBuilder.createDiff('test.ts', 'old', 'new'),
          },
        ],
        status: ProposalStatus.PENDING,
      };

      const result = validator.validateConstraints(proposal);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject proposal with too many files', () => {
      const changes = Array.from({ length: 15 }, (_, i) => ({
        filePath: `file${i}.ts`,
        oldContent: 'old',
        newContent: 'new',
        diff: diffBuilder.createDiff(`file${i}.ts`, 'old', 'new'),
      }));

      const proposal: CodeEditProposal = {
        id: 'test-2',
        agentName: 'test-agent',
        timestamp: new Date(),
        description: 'Too many files',
        changes,
        status: ProposalStatus.PENDING,
      };

      const result = validator.validateConstraints(proposal, { maxFiles: 10 });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Too many files');
    });

    it('should warn about large diffs', () => {
      const largeContent = 'line\n'.repeat(600);
      const proposal: CodeEditProposal = {
        id: 'test-3',
        agentName: 'test-agent',
        timestamp: new Date(),
        description: 'Large change',
        changes: [
          {
            filePath: 'large.ts',
            oldContent: 'old',
            newContent: largeContent,
            diff: diffBuilder.createDiff('large.ts', 'old', largeContent),
          },
        ],
        status: ProposalStatus.PENDING,
      };

      const result = validator.validateConstraints(proposal, { maxDiffLines: 500 });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Large diff');
    });

    it('should warn about large deletions', () => {
      const largeContent = 'line\n'.repeat(200);
      const proposal: CodeEditProposal = {
        id: 'test-4',
        agentName: 'test-agent',
        timestamp: new Date(),
        description: 'Large deletion',
        changes: [
          {
            filePath: 'shrink.ts',
            oldContent: largeContent,
            newContent: 'small',
            diff: diffBuilder.createDiff('shrink.ts', largeContent, 'small'),
          },
        ],
        status: ProposalStatus.PENDING,
      };

      const result = validator.validateConstraints(proposal);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('deletion'))).toBe(true);
    });
  });

  describe('validateFilePaths', () => {
    it('should accept normal relative paths', () => {
      const result = validator.validateFilePaths([
        'src/utils/helper.ts',
        'tests/unit/test.spec.ts',
      ]);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject path traversal attempts', () => {
      const result = validator.validateFilePaths(['../../../etc/passwd']);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Path traversal');
    });

    it('should warn about absolute paths', () => {
      const result = validator.validateFilePaths(['/absolute/path/file.ts']);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Absolute path');
    });

    it('should warn about hidden files', () => {
      const result = validator.validateFilePaths(['.hidden/file.ts']);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('Hidden');
    });
  });
});

describe('generateProposalId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateProposalId();
    const id2 = generateProposalId();

    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^edit_\d+_[a-z0-9]+$/);
  });
});

describe('summarizeProposal', () => {
  it('should create human-readable summary', () => {
    const diffBuilder = new DiffBuilder();
    const proposal: CodeEditProposal = {
      id: 'test-123',
      agentName: 'my-agent',
      timestamp: new Date(),
      description: 'Fix critical bug',
      changes: [
        {
          filePath: 'src/bug.ts',
          oldContent: 'buggy',
          newContent: 'fixed',
          diff: diffBuilder.createDiff('src/bug.ts', 'buggy', 'fixed'),
        },
      ],
      status: ProposalStatus.PENDING,
    };

    const summary = summarizeProposal(proposal);

    expect(summary).toContain('test-123');
    expect(summary).toContain('my-agent');
    expect(summary).toContain('Fix critical bug');
    expect(summary).toContain('src/bug.ts');
    expect(summary).toContain('pending');
  });
});
