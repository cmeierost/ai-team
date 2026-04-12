import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeEditManager } from './code-edit-manager.js';
import { ProposalStatus } from './edit-proposal.js';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CodeEditManager', () => {
  let manager: CodeEditManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    manager = new CodeEditManager();
    testDir = join(tmpdir(), `edit-manager-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    testFile = join(testDir, 'test.ts');
    await writeFile(testFile, 'const x = 1;', 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('createProposal', () => {
    it('should create a valid proposal', async () => {
      const input = {
        description: 'Update variable',
        changes: [
          {
            filePath: testFile,
            oldContent: 'const x = 1;',
            newContent: 'const x = 2;',
          },
        ],
      };

      const { proposal, validation } = await manager.createProposal('test-agent', input);

      expect(proposal.id).toBeDefined();
      expect(proposal.agentName).toBe('test-agent');
      expect(proposal.description).toBe('Update variable');
      expect(proposal.changes).toHaveLength(1);
      expect(proposal.status).toBe(ProposalStatus.PENDING);
      expect(validation.valid).toBe(true);
    });

    it('should validate input structure', async () => {
      const invalidInput = {
        description: '',
        changes: [],
      };

      await expect(
        manager.createProposal('test-agent', invalidInput as any)
      ).rejects.toThrow('Invalid proposal input');
    });

    it('should validate file paths', async () => {
      const input = {
        description: 'Dangerous change',
        changes: [
          {
            filePath: '../../../etc/passwd',
            oldContent: 'old',
            newContent: 'new',
          },
        ],
      };

      await expect(
        manager.createProposal('test-agent', input)
      ).rejects.toThrow('Invalid file paths');
    });

    it('should generate diffs for all changes', async () => {
      const input = {
        description: 'Multi-file update',
        changes: [
          {
            filePath: join(testDir, 'file1.ts'),
            oldContent: 'a',
            newContent: 'b',
          },
          {
            filePath: join(testDir, 'file2.ts'),
            oldContent: 'x',
            newContent: 'y',
          },
        ],
      };

      const { proposal } = await manager.createProposal('test-agent', input);

      expect(proposal.changes).toHaveLength(2);
      expect(proposal.changes[0].diff).toBeDefined();
      expect(proposal.changes[1].diff).toBeDefined();
      expect(proposal.changes[0].diff.additions).toBeGreaterThan(0);
    });
  });

  describe('getProposal', () => {
    it('should retrieve proposal by ID', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const retrieved = manager.getProposal(proposal.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(proposal.id);
    });

    it('should return undefined for non-existent ID', () => {
      const retrieved = manager.getProposal('nonexistent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllProposals', () => {
    it('should return all proposals', async () => {
      await manager.createProposal('agent1', {
        description: 'Change 1',
        changes: [{ filePath: testFile, oldContent: 'a', newContent: 'b' }],
      });

      await manager.createProposal('agent2', {
        description: 'Change 2',
        changes: [{ filePath: testFile, oldContent: 'x', newContent: 'y' }],
      });

      const all = manager.getAllProposals();

      expect(all).toHaveLength(2);
    });
  });

  describe('getProposalsByStatus', () => {
    it('should filter proposals by status', async () => {
      const { proposal: p1 } = await manager.createProposal('agent1', {
        description: 'Change 1',
        changes: [{ filePath: testFile, oldContent: 'a', newContent: 'b' }],
      });

      const { proposal: p2 } = await manager.createProposal('agent2', {
        description: 'Change 2',
        changes: [{ filePath: testFile, oldContent: 'x', newContent: 'y' }],
      });

      manager.approveProposal(p1.id);

      const pending = manager.getProposalsByStatus(ProposalStatus.PENDING);
      const approved = manager.getProposalsByStatus(ProposalStatus.APPROVED);

      expect(pending).toHaveLength(1);
      expect(approved).toHaveLength(1);
      expect(pending[0].id).toBe(p2.id);
      expect(approved[0].id).toBe(p1.id);
    });
  });

  describe('getProposalsByAgent', () => {
    it('should filter proposals by agent', async () => {
      await manager.createProposal('agent1', {
        description: 'Change 1',
        changes: [{ filePath: testFile, oldContent: 'a', newContent: 'b' }],
      });

      await manager.createProposal('agent2', {
        description: 'Change 2',
        changes: [{ filePath: testFile, oldContent: 'x', newContent: 'y' }],
      });

      const agent1Proposals = manager.getProposalsByAgent('agent1');

      expect(agent1Proposals).toHaveLength(1);
      expect(agent1Proposals[0].agentName).toBe('agent1');
    });
  });

  describe('approveProposal', () => {
    it('should approve a pending proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const approved = manager.approveProposal(proposal.id);

      expect(approved.status).toBe(ProposalStatus.APPROVED);
    });

    it('should throw error for non-existent proposal', () => {
      expect(() => manager.approveProposal('nonexistent')).toThrow('not found');
    });

    it('should throw error for non-pending proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      manager.approveProposal(proposal.id);

      expect(() => manager.approveProposal(proposal.id)).toThrow('cannot approve');
    });
  });

  describe('rejectProposal', () => {
    it('should reject a pending proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const rejected = manager.rejectProposal(proposal.id, 'Not needed');

      expect(rejected.status).toBe(ProposalStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('Not needed');
    });
  });

  describe('applyProposal', () => {
    it('should apply an approved proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Update file',
        changes: [
          {
            filePath: testFile,
            oldContent: 'const x = 1;',
            newContent: 'const x = 2;',
          },
        ],
      });

      manager.approveProposal(proposal.id);
      const applied = await manager.applyProposal(proposal.id);

      expect(applied.status).toBe(ProposalStatus.APPLIED);

      // Verify file was actually written
      const fs = await import('fs/promises');
      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('const x = 2;');
    });

    it('should throw error for non-approved proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      await expect(manager.applyProposal(proposal.id)).rejects.toThrow('cannot apply');
    });

    it('should handle file write errors', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [
          {
            filePath: '/nonexistent/path/file.ts',
            oldContent: 'old',
            newContent: 'new',
          },
        ],
      });

      manager.approveProposal(proposal.id);

      await expect(manager.applyProposal(proposal.id)).rejects.toThrow();

      const failed = manager.getProposal(proposal.id);
      expect(failed?.status).toBe(ProposalStatus.FAILED);
      expect(failed?.errorMessage).toBeDefined();
    });
  });

  describe('previewProposal', () => {
    it('should preview proposal without applying', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test preview',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const preview = manager.previewProposal(proposal.id);

      expect(preview.proposal).toBeDefined();
      expect(preview.diffs).toHaveLength(1);
      expect(preview.summary).toContain('file');
    });
  });

  describe('getTerminalDiffs', () => {
    it('should format diffs for terminal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const terminalDiffs = manager.getTerminalDiffs(proposal.id);

      expect(terminalDiffs).toHaveLength(1);
      expect(terminalDiffs[0]).toContain('diff --git');
      expect(terminalDiffs[0]).toMatch(/\x1b\[\d+m/); // ANSI codes
    });
  });

  describe('deleteProposal', () => {
    it('should delete a proposal', async () => {
      const { proposal } = await manager.createProposal('test-agent', {
        description: 'Test',
        changes: [{ filePath: testFile, oldContent: 'old', newContent: 'new' }],
      });

      const deleted = manager.deleteProposal(proposal.id);

      expect(deleted).toBe(true);
      expect(manager.getProposal(proposal.id)).toBeUndefined();
    });
  });

  describe('clearProposals', () => {
    it('should clear all proposals', async () => {
      await manager.createProposal('agent1', {
        description: 'Test 1',
        changes: [{ filePath: testFile, oldContent: 'a', newContent: 'b' }],
      });

      await manager.createProposal('agent2', {
        description: 'Test 2',
        changes: [{ filePath: testFile, oldContent: 'x', newContent: 'y' }],
      });

      manager.clearProposals();

      expect(manager.getAllProposals()).toHaveLength(0);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', async () => {
      const { proposal: p1 } = await manager.createProposal('agent1', {
        description: 'Test 1',
        changes: [{ filePath: testFile, oldContent: 'a', newContent: 'b' }],
      });

      const { proposal: p2 } = await manager.createProposal('agent2', {
        description: 'Test 2',
        changes: [{ filePath: testFile, oldContent: 'x', newContent: 'y' }],
      });

      manager.approveProposal(p1.id);
      manager.rejectProposal(p2.id, 'Test');

      const stats = manager.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(0);
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.applied).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });
});
