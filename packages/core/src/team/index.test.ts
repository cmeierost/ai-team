import { describe, expect, it, beforeEach } from 'vitest';
import { TeamGraphBuilder } from './index.js';
import { AgentManager } from '../agent/index.js';
import { Agent, EdgeType, RoleType, ContextLevel } from '../types/index.js';

describe('TeamGraphBuilder', () => {
  let agentManager: AgentManager;
  let graphBuilder: TeamGraphBuilder;

  beforeEach(() => {
    agentManager = new AgentManager('/workspace');
    graphBuilder = new TeamGraphBuilder(agentManager);
  });

  describe('parent resolution by role', () => {
    it('resolves parent by exact ID (backward compatibility)', () => {
      const ceo: Agent = {
        id: 'john-smith',
        name: 'John Smith',
        role: 'ceo',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.ORGANIZATION,
        status: 'available',
      };

      const cto: Agent = {
        id: 'alex-carter',
        name: 'Alex Carter',
        role: 'cto',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
        reportsTo: 'john-smith', // Exact ID reference
      };

      agentManager['agents'].set('john-smith', ceo);
      agentManager['agents'].set('alex-carter', cto);

      const graph = graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        e => e.source === 'alex-carter' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('john-smith');
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
      expect(reportEdge?.error).toBeUndefined();
    });

    it('resolves parent by exact role name', () => {
      const ceo: Agent = {
        id: 'john-smith',
        name: 'John Smith',
        role: 'ceo',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.ORGANIZATION,
        status: 'available',
      };

      const cto: Agent = {
        id: 'alex-carter',
        name: 'Alex Carter',
        role: 'cto',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
        reportsTo: 'ceo', // Role reference instead of ID
      };

      agentManager['agents'].set('john-smith', ceo);
      agentManager['agents'].set('alex-carter', cto);

      const graph = graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        e => e.source === 'alex-carter' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('john-smith'); // Resolved from 'ceo' to 'john-smith'
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
      expect(reportEdge?.error).toBeUndefined();
    });

    it('resolves parent by partial role match', () => {
      const architect: Agent = {
        id: 'maya-tech',
        name: 'Maya Rodriguez',
        role: 'chief-architect',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
      };

      const dev: Agent = {
        id: 'jordan-dev',
        name: 'Jordan Lee',
        role: 'senior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        reportsTo: 'architect', // Partial match to 'chief-architect'
      };

      agentManager['agents'].set('maya-tech', architect);
      agentManager['agents'].set('jordan-dev', dev);

      const graph = graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        e => e.source === 'jordan-dev' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('maya-tech');
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
    });

    it('creates broken edge for non-existent manager', () => {
      const dev: Agent = {
        id: 'jordan-dev',
        name: 'Jordan Lee',
        role: 'senior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        reportsTo: 'nonexistent-manager',
      };

      agentManager['agents'].set('jordan-dev', dev);

      const graph = graphBuilder.buildGraph('hierarchy');

      const brokenEdge = graph.edges.find(
        e => e.source === 'jordan-dev' && e.type === EdgeType.REPORTS_TO_UNRESOLVED
      );

      expect(brokenEdge).toBeDefined();
      expect(brokenEdge?.target).toBe('nonexistent-manager'); // Preserves original
      expect(brokenEdge?.error).toContain('not found');
    });

    it('creates broken edge for ambiguous role reference', () => {
      // Two agents with same role
      const dev1: Agent = {
        id: 'jordan-1',
        name: 'Jordan Lee',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
      };

      const dev2: Agent = {
        id: 'jordan-2',
        name: 'Jordan Smith',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
      };

      const junior: Agent = {
        id: 'casey-junior',
        name: 'Casey Brown',
        role: 'junior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        reportsTo: 'developer', // Ambiguous - matches both dev1 and dev2
      };

      agentManager['agents'].set('jordan-1', dev1);
      agentManager['agents'].set('jordan-2', dev2);
      agentManager['agents'].set('casey-junior', junior);

      const graph = graphBuilder.buildGraph('hierarchy');

      const brokenEdge = graph.edges.find(
        e => e.source === 'casey-junior' && e.type === EdgeType.REPORTS_TO_UNRESOLVED
      );

      expect(brokenEdge).toBeDefined();
      expect(brokenEdge?.error).toContain('Ambiguous');
      expect(brokenEdge?.error).toContain('Jordan Lee');
      expect(brokenEdge?.error).toContain('Jordan Smith');
    });

    it('handles mixed ID and role references in same graph', () => {
      const ceo: Agent = {
        id: 'ceo-id',
        name: 'CEO Name',
        role: 'ceo',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.ORGANIZATION,
        status: 'available',
      };

      const cto: Agent = {
        id: 'cto-id',
        name: 'CTO Name',
        role: 'cto',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
        reportsTo: 'ceo-id', // ID reference
      };

      const dev: Agent = {
        id: 'dev-id',
        name: 'Dev Name',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        reportsTo: 'cto', // Role reference
      };

      agentManager['agents'].set('ceo-id', ceo);
      agentManager['agents'].set('cto-id', cto);
      agentManager['agents'].set('dev-id', dev);

      const graph = graphBuilder.buildGraph('hierarchy');

      const ctoEdge = graph.edges.find(
        e => e.source === 'cto-id' && e.type === EdgeType.REPORTS_TO
      );
      const devEdge = graph.edges.find(
        e => e.source === 'dev-id' && e.type === EdgeType.REPORTS_TO
      );

      expect(ctoEdge?.target).toBe('ceo-id'); // ID resolution
      expect(devEdge?.target).toBe('cto-id'); // Role resolution
      expect(ctoEdge?.error).toBeUndefined();
      expect(devEdge?.error).toBeUndefined();
    });

    it('prefers exact ID match over role name when both exist', () => {
      // Edge case: ID happens to match another agent's role
      const agent1: Agent = {
        id: 'manager',
        name: 'Manager Agent',
        role: 'senior-manager',
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
      };

      const agent2: Agent = {
        id: 'director',
        name: 'Director Agent',
        role: 'manager', // Role name same as agent1's ID
        type: RoleType.LEADER,
        contextLevel: ContextLevel.FEATURE,
        status: 'available',
      };

      const dev: Agent = {
        id: 'dev',
        name: 'Dev Agent',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        reportsTo: 'manager', // Should resolve to agent1 (exact ID) not agent2 (role)
      };

      agentManager['agents'].set('manager', agent1);
      agentManager['agents'].set('director', agent2);
      agentManager['agents'].set('dev', dev);

      const graph = graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        e => e.source === 'dev' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge?.target).toBe('manager'); // Exact ID match wins
    });
  });

  describe('graph structure validation', () => {
    it('creates nodes for all agents', () => {
      const agent1: Agent = {
        id: 'agent-1',
        name: 'Agent One',
        role: 'role-1',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
      };

      const agent2: Agent = {
        id: 'agent-2',
        name: 'Agent Two',
        role: 'role-2',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
      };

      agentManager['agents'].set('agent-1', agent1);
      agentManager['agents'].set('agent-2', agent2);

      const graph = graphBuilder.buildGraph('hierarchy');

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.find(n => n.id === 'agent-1')).toBeDefined();
      expect(graph.nodes.find(n => n.id === 'agent-2')).toBeDefined();
    });

    it('creates no edges when no reporting relationships exist', () => {
      const agent: Agent = {
        id: 'solo-agent',
        name: 'Solo Agent',
        role: 'freelancer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: 'available',
        // No reportsTo
      };

      agentManager['agents'].set('solo-agent', agent);

      const graph = graphBuilder.buildGraph('hierarchy');

      expect(graph.edges).toHaveLength(0);
    });
  });
});
