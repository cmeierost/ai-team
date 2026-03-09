import { describe, it, expect, beforeEach } from 'vitest';
import { AgentManager } from '@ai-team/core';
import { resolveAgentForOperation, resolveAgentSafe } from './agent-resolution.js';
import { AmbiguousAgentQueryError } from '../errors.js';
import { AgentNotFoundError } from '@ai-team/core';

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
    ];

    // Override resolveAgent to return mock data
    agentManager.resolveAgent = (query: string) => {
      const q = query.toLowerCase().trim();
      
      // Exact ID match
      const exactId = mockAgents.find(a => a.id === q);
      if (exactId) return [exactId];
      
      // Exact role match
      const exactRole = mockAgents.filter(a => a.role.toLowerCase() === q);
      if (exactRole.length > 0) return exactRole;
      
      // Exact name match
      const exactName = mockAgents.filter(a => a.name.toLowerCase() === q);
      if (exactName.length > 0) return exactName;
      
      // Partial name match
      const partialName = mockAgents.filter(a => a.name.toLowerCase().includes(q));
      if (partialName.length > 0) return partialName;
      
      return [];
    };

    agentManager.getAllAgents = () => mockAgents as any;
  });

  describe('resolveAgentForOperation', () => {
    it('should resolve exact agent ID', () => {
      const result = resolveAgentForOperation(agentManager, 'john-smith', 'test operation');
      expect(result).toEqual({ id: 'john-smith', name: 'John Smith', role: 'hr-director' });
    });

    it('should resolve agent by role', () => {
      const result = resolveAgentForOperation(agentManager, 'cto', 'test operation');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should resolve agent by full name', () => {
      const result = resolveAgentForOperation(agentManager, 'Emily Davis', 'test operation');
      expect(result).toEqual({ id: 'emily-davis', name: 'Emily Davis', role: 'developer' });
    });

    it('should resolve agent by partial name', () => {
      const result = resolveAgentForOperation(agentManager, 'Michael', 'test operation');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should throw AgentNotFoundError when no match found', () => {
      expect(() => {
        resolveAgentForOperation(agentManager, 'nonexistent', 'test operation');
      }).toThrow(AgentNotFoundError);
    });

    it('should throw AmbiguousAgentQueryError when multiple matches found', () => {
      // Mock multiple matches
      agentManager.resolveAgent = () => [
        { id: 'emily-davis', name: 'Emily Davis', role: 'developer' } as any,
        { id: 'alex-jones', name: 'Alex Jones', role: 'developer' } as any,
      ];

      expect(() => {
        resolveAgentForOperation(agentManager, 'developer', 'test operation');
      }).toThrow(AmbiguousAgentQueryError);
    });

    it('should include operation context in error message', () => {
      try {
        resolveAgentForOperation(agentManager, 'nonexistent', 'list sessions');
        expect.fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('list sessions');
        expect(error.message).toContain('nonexistent');
      }
    });
  });

  describe('resolveAgentSafe', () => {
    it('should resolve agent without throwing', () => {
      const result = resolveAgentSafe(agentManager, 'cto');
      expect(result).toEqual({ id: 'michael-brown', name: 'Michael Brown', role: 'cto' });
    });

    it('should return null when no match found', () => {
      const result = resolveAgentSafe(agentManager, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when multiple matches found', () => {
      agentManager.resolveAgent = () => [
        { id: 'emily-davis', name: 'Emily Davis', role: 'developer' } as any,
        { id: 'alex-jones', name: 'Alex Jones', role: 'developer' } as any,
      ];

      const result = resolveAgentSafe(agentManager, 'developer');
      expect(result).toBeNull();
    });

    it('should return null when agentManager is undefined', () => {
      const result = resolveAgentSafe(undefined, 'cto');
      expect(result).toBeNull();
    });

    it('should handle exact ID match', () => {
      const result = resolveAgentSafe(agentManager, 'john-smith');
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
