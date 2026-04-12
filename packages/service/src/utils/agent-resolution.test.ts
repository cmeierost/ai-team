import { describe, it, expect, beforeEach } from 'vitest';
import { AgentNotFoundError } from '@ai-team/core';
import { AgentManager } from '@ai-team/infrastructure';
import { resolveAgentForOperationAsync, resolveAgentSafe } from './agent-resolution.js';
import { AmbiguousAgentQueryError } from '../errors.js';

describe('Agent Resolution Utilities', () => {
  let agentManager: AgentManager;

  beforeEach(() => {
    // Create a mock agent manager with test agents
    agentManager = new AgentManager('/test/workspace');

    // Mock the agents map and resolveAgent method
    const mockAgents = [
      { id: 'john-smith', name: 'John Smith', role: 'hr-director' },
      { id: 'michael-brown', name: 'Michael Brown', role: 'cto' },
      { id: 'emily-davis', name: 'Emily Davis', role: 'developer' },
      { id: 'sarah-lee', name: 'Sarah Lee', role: 'chief-architect' },
    ] as any[];

    // Override resolveAgent to return mock data
    agentManager.resolveAgentAsync = async (query: string) => {
      const q = query.toLowerCase().trim();

      // Exact ID match
      const exactId = mockAgents.find((a) => a.id === q);
      if (exactId) return [exactId];

      // Exact role match
      const exactRole = mockAgents.filter((a) => a.role.toLowerCase() === q);
      if (exactRole.length > 0) return exactRole;

      // Exact name match
      const exactName = mockAgents.filter((a) => a.name.toLowerCase() === q);
      if (exactName.length > 0) return exactName;

      // Partial name match
      const partialName = mockAgents.filter((a) => a.name.toLowerCase().includes(q));
      if (partialName.length > 0) return partialName;

      return [];
    };

    agentManager.getAllAgentsAsync = async () => mockAgents as any;
  });

  describe('resolveAgentForOperation', () => {
    it('should resolve exact agent ID', async () => {
      const result = await resolveAgentForOperationAsync(
        agentManager,
        'john-smith',
        'test operation'
      );
      expect(result).toEqual({ id: 'john-smith', name: 'John Smith', role: 'hr-director' });
    });

    it('should resolve agent by role', async () => {
      const result = await resolveAgentForOperationAsync(agentManager, 'cto', 'test operation');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should resolve agent by full name', async () => {
      const result = await resolveAgentForOperationAsync(
        agentManager,
        'Emily Davis',
        'test operation'
      );
      expect(result).toEqual({ id: 'emily-davis', name: 'Emily Davis', role: 'developer' });
    });

    it('should resolve agent by partial name', async () => {
      const result = await resolveAgentForOperationAsync(agentManager, 'Michael', 'test operation');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should throw AgentNotFoundError when no match found', async () => {
      await expect(
        resolveAgentForOperationAsync(agentManager, 'nonexistent', 'test operation')
      ).rejects.toThrow(AgentNotFoundError);
    });

    it('should throw AmbiguousAgentQueryError when multiple matches found', async () => {
      // Mock multiple matches
      agentManager.resolveAgentAsync = async () => [
        { id: 'emily-davis', name: 'Emily Davis', role: 'developer' } as any,
        { id: 'alex-jones', name: 'Alex Jones', role: 'developer' } as any,
      ];

      await expect(
        resolveAgentForOperationAsync(agentManager, 'developer', 'test operation')
      ).rejects.toThrow(AmbiguousAgentQueryError);
    });

    it('should include operation context in error message', async () => {
      await expect(
        resolveAgentForOperationAsync(agentManager, 'nonexistent', 'list sessions')
      ).rejects.toSatisfy((error: any) => {
        expect(error.message).toContain('list sessions');
        expect(error.message).toContain('nonexistent');
        return true;
      });
    });
  });

  describe('resolveAgentSafe', () => {
    it('should resolve agent without throwing', async () => {
      const result = await resolveAgentSafe(agentManager, 'cto');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should return null when no match found', async () => {
      const result = await resolveAgentSafe(agentManager, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when multiple matches found', async () => {
      agentManager.resolveAgentAsync = async () => [
        { id: 'emily-davis', name: 'Emily Davis', role: 'developer' } as any,
        { id: 'alex-jones', name: 'Alex Jones', role: 'developer' } as any,
      ];

      const result = await resolveAgentSafe(agentManager, 'developer');
      expect(result).toBeNull();
    });

    it('should return null when agentManager is undefined', async () => {
      const result = await resolveAgentSafe(undefined, 'cto');
      expect(result).toBeNull();
    });

    it('should handle exact ID match', async () => {
      const result = await resolveAgentSafe(agentManager, 'john-smith');
      expect(result).toEqual({ id: 'john-smith', name: 'John Smith', role: 'hr-director' });
    });
  });

  describe('AmbiguousAgentQueryError', () => {
    it('should format error message with match details', () => {
      const matches = [
        { id: 'emily-davis', name: 'Emily Davis', role: 'developer' },
        { id: 'alex-jones', name: 'Alex Jones', role: 'developer' },
      ];

      const error = new AmbiguousAgentQueryError('developer', matches);

      expect(error.query).toBe('developer');
      expect(error.matches).toEqual(matches);
      expect(error.message).toContain('developer');
      expect(error.message).toContain('Emily Davis');
      expect(error.message).toContain('Alex Jones');
      expect(error.message).toContain('Please be more specific');
    });
  });
});
