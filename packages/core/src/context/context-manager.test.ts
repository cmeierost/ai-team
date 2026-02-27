import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './index.js';
import { ContextLevel, type Agent } from '../types/index.js';

describe('ContextManager - Edit Validation', () => {
  let contextManager: ContextManager;
  const workspaceRoot = '/workspace';

  beforeEach(() => {
    contextManager = new ContextManager(workspaceRoot);
  });

  const createAgent = (id: string, writePatterns: string[]): Agent => ({
    id,
    name: `Agent ${id}`,
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    permissions: {
      read: ['**/*'],
      write: writePatterns,
    },
  });

  describe('validateEditProposal', () => {
    it('should allow editing when agent has permission', () => {
      const agent = createAgent('agent1', ['src/module-a/**/*']);

      const result = contextManager.validateEditProposal(agent, [
        '/workspace/src/module-a/file1.ts',
        '/workspace/src/module-a/file2.ts',
      ]);

      expect(result.allowed).toBe(true);
      expect(result.blockedFiles).toHaveLength(0);
    });

    it('should block files agent cannot write', () => {
      const agent = createAgent('agent1', ['src/module-a/**/*']);

      const result = contextManager.validateEditProposal(agent, [
        '/workspace/src/module-a/allowed.ts',
        '/workspace/src/module-b/blocked.ts',
      ]);

      expect(result.allowed).toBe(false);
      expect(result.blockedFiles).toHaveLength(1);
      expect(result.blockedFiles[0]).toContain('module-b');
      expect(result.message).toContain('cannot write');
    });

    it('should validate all files in proposal', () => {
      const agent = createAgent('agent1', ['src/ui/**/*']);

      const result = contextManager.validateEditProposal(agent, [
        '/workspace/src/backend/controller.ts',
        '/workspace/src/backend/service.ts',
        '/workspace/docs/README.md',
      ]);

      expect(result.allowed).toBe(false);
      expect(result.blockedFiles).toHaveLength(3);
    });

    it('should handle empty file list', () => {
      const agent = createAgent('agent1', ['**/*']);

      const result = contextManager.validateEditProposal(agent, []);

      expect(result.allowed).toBe(true);
      expect(result.blockedFiles).toHaveLength(0);
    });
  });

  describe('getPermissionGuidance', () => {
    it('should suggest agents that can write to file', () => {
      const agents: Agent[] = [
        createAgent('backend-dev', ['src/backend/**/*']),
        createAgent('frontend-dev', ['src/frontend/**/*']),
        createAgent('fullstack-dev', ['src/**/*']),
      ];

      const guidance = contextManager.getPermissionGuidance(
        '/workspace/src/backend/api.ts',
        agents
      );

      expect(guidance.canWrite).toHaveLength(2); // backend-dev and fullstack-dev
      expect(guidance.canWrite.find(a => a.id === 'backend-dev')).toBeDefined();
      expect(guidance.canWrite.find(a => a.id === 'fullstack-dev')).toBeDefined();
      expect(guidance.suggestions.length).toBeGreaterThan(0);
    });

    it('should handle file with no authorized agents', () => {
      const agents: Agent[] = [
        createAgent('dev1', ['src/module-a/**/*']),
        createAgent('dev2', ['src/module-b/**/*']),
      ];

      const guidance = contextManager.getPermissionGuidance(
        '/workspace/src/module-c/file.ts',
        agents
      );

      expect(guidance.canWrite).toHaveLength(0);
      expect(guidance.suggestions[0]).toContain('No agents');
    });

    it('should handle single authorized agent', () => {
      const agents: Agent[] = [
        createAgent('specialist', ['src/critical/**/*']),
        createAgent('general', ['src/common/**/*']),
      ];

      const guidance = contextManager.getPermissionGuidance(
        '/workspace/src/critical/security.ts',
        agents
      );

      expect(guidance.canWrite).toHaveLength(1);
      expect(guidance.suggestions[0]).toContain('Only');
      expect(guidance.suggestions[0]).toContain('specialist');
    });

    it('should handle multiple authorized agents', () => {
      const agents: Agent[] = [
        createAgent('dev1', ['src/**/*']),
        createAgent('dev2', ['src/**/*']),
        createAgent('dev3', ['src/**/*']),
      ];

      const guidance = contextManager.getPermissionGuidance(
        '/workspace/src/file.ts',
        agents
      );

      expect(guidance.canWrite).toHaveLength(3);
      expect(guidance.suggestions[0]).toContain('3 agents');
    });
  });

  describe('getBlockedFiles', () => {
    it('should return detailed information about blocked files', () => {
      const agent = createAgent('agent1', ['src/frontend/**/*', 'tests/**/*']);

      const blocked = contextManager.getBlockedFiles(agent, [
        '/workspace/src/backend/api.ts',
        '/workspace/docs/README.md',
      ]);

      expect(blocked).toHaveLength(2);

      const backendFile = blocked.find(b => b.relativePath.includes('backend'));
      expect(backendFile).toBeDefined();
      expect(backendFile?.reason).toContain('does not match');
      expect(backendFile?.reason).toContain('src/frontend');
    });

    it('should explain when agent has no write permissions', () => {
      const agent: Agent = {
        id: 'readonly',
        name: 'Read-only Agent',
        role: 'viewer',
        contextLevel: ContextLevel.TASK,
        permissions: {
          read: ['**/*'],
          write: [],
        },
      };

      const blocked = contextManager.getBlockedFiles(agent, [
        '/workspace/src/file.ts',
      ]);

      expect(blocked).toHaveLength(1);
      expect(blocked[0].reason).toContain('no write permissions');
    });

    it('should handle agent without permissions config', () => {
      const agent: Agent = {
        id: 'noperm',
        name: 'No Permissions',
        role: 'test',
        contextLevel: ContextLevel.TASK,
      };

      const blocked = contextManager.getBlockedFiles(agent, [
        '/workspace/test.ts',
      ]);

      expect(blocked).toHaveLength(1);
    });

    it('should include relative paths', () => {
      const agent = createAgent('agent1', ['allowed/**/*']);

      const blocked = contextManager.getBlockedFiles(agent, [
        '/workspace/blocked/file.ts',
      ]);

      expect(blocked).toHaveLength(1);
      expect(blocked[0].filePath).toBe('/workspace/blocked/file.ts');
      // Normalize path separators (Windows uses backslash)
      const normalizedPath = blocked[0].relativePath.replace(/\\/g, '/');
      expect(normalizedPath).toBe('blocked/file.ts');
    });
  });

  describe('Integration with existing permissions', () => {
    it('should work with canWrite method', () => {
      const agent = createAgent('agent1', ['src/module-a/**/*']);

      const canWriteAllowed = contextManager.canWrite(
        agent,
        '/workspace/src/module-a/file.ts'
      );
      const canWriteBlocked = contextManager.canWrite(
        agent,
        '/workspace/src/module-b/file.ts'
      );

      expect(canWriteAllowed).toBe(true);
      expect(canWriteBlocked).toBe(false);

      // Validate proposal should match
      const validation = contextManager.validateEditProposal(agent, [
        '/workspace/src/module-a/file.ts',
        '/workspace/src/module-b/file.ts',
      ]);

      expect(validation.allowed).toBe(false);
      expect(validation.blockedFiles).toContain('/workspace/src/module-b/file.ts');
    });
  });
});
