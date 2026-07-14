import { describe, expect, it, beforeEach } from 'vitest';
import { TeamGraphBuilder } from './team-graph-builder.js';
import { AgentManager } from './agent-manager.js';
import { PermFileRegistry } from 'fs-context';
import { AgentDocumentStorage } from './agent-document-storage.js';
import { MarkdownSectionService } from './markdown-service.js';
import { WorkspaceDiscoveryStorage } from './workspace-discovery-storage.js';
import { WorkspaceStorage } from './workspace-storage.js';
import { Agent, EdgeType, RoleType, ContextLevel, AgentStatus } from '@ai-team/core';

function createTestAgentManager(workspaceRoot: string): AgentManager {
  return new AgentManager(
    workspaceRoot,
    new AgentDocumentStorage(
      workspaceRoot,
      new MarkdownSectionService(),
      new WorkspaceStorage(workspaceRoot),
      new WorkspaceDiscoveryStorage(workspaceRoot)
    ),
    new WorkspaceStorage(workspaceRoot),
    new WorkspaceDiscoveryStorage(workspaceRoot),
    new PermFileRegistry(workspaceRoot)
  );
}

function makeAgent(p: Partial<Agent> & { id: string; name: string; role: string }): Agent {
  return { filePath: '', skillPath: '', createdAt: '', ...p } as Agent;
}

describe('TeamGraphBuilder', () => {
  let agentManager: AgentManager;
  let graphBuilder: TeamGraphBuilder;

  beforeEach(() => {
    agentManager = createTestAgentManager('/workspace');
    graphBuilder = new TeamGraphBuilder(agentManager);
  });

  describe('parent resolution by role', () => {
    it('resolves parent by exact ID (backward compatibility)', async () => {
      const ceo = makeAgent({
        id: 'john-smith',
        name: 'John Smith',
        role: 'ceo',
        type: RoleType.EXECUTIVE,
        contextLevel: ContextLevel.ORGANIZATION,
        status: AgentStatus.AVAILABLE,
      });

      const cto = makeAgent({
        id: 'alex-carter',
        name: 'Alex Carter',
        role: 'cto',
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'john-smith', // Exact ID reference
      });

      agentManager['agents'].set('john-smith', ceo);
      agentManager['agents'].set('alex-carter', cto);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        (e) => e.source === 'alex-carter' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('john-smith');
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
      expect(reportEdge?.error).toBeUndefined();
    });

    it('resolves parent by exact role name', async () => {
      const ceo = makeAgent({
        id: 'john-smith',
        name: 'John Smith',
        role: 'ceo',
        type: RoleType.EXECUTIVE,
        contextLevel: ContextLevel.ORGANIZATION,
        status: AgentStatus.AVAILABLE,
      });

      const cto = makeAgent({
        id: 'alex-carter',
        name: 'Alex Carter',
        role: 'cto',
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'ceo', // Role reference instead of ID
      });

      agentManager['agents'].set('john-smith', ceo);
      agentManager['agents'].set('alex-carter', cto);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        (e) => e.source === 'alex-carter' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('john-smith'); // Resolved from 'ceo' to 'john-smith'
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
      expect(reportEdge?.error).toBeUndefined();
    });

    it('resolves parent by partial role match', async () => {
      const architect = makeAgent({
        id: 'maya-tech',
        name: 'Maya Rodriguez',
        role: 'chief-architect',
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
      });

      const dev = makeAgent({
        id: 'jordan-dev',
        name: 'Sarah Lee',
        role: 'senior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'architect', // Partial match to 'chief-architect'
      });

      agentManager['agents'].set('maya-tech', architect);
      agentManager['agents'].set('jordan-dev', dev);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        (e) => e.source === 'jordan-dev' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge).toBeDefined();
      expect(reportEdge?.target).toBe('maya-tech');
      expect(reportEdge?.type).toBe(EdgeType.REPORTS_TO);
    });

    it('creates broken edge for non-existent manager', async () => {
      const dev = makeAgent({
        id: 'jordan-dev',
        name: 'Sarah Lee',
        role: 'senior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'nonexistent-manager',
      });

      agentManager['agents'].set('jordan-dev', dev);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const brokenEdge = graph.edges.find(
        (e) => e.source === 'jordan-dev' && e.type === EdgeType.REPORTS_TO_UNRESOLVED
      );

      expect(brokenEdge).toBeDefined();
      expect(brokenEdge?.target).toBe('nonexistent-manager'); // Preserves original
      expect(brokenEdge?.error).toContain('not found');
    });

    it('creates broken edge for ambiguous role reference', async () => {
      // Two agents with same role
      const dev1 = makeAgent({
        id: 'jordan-1',
        name: 'Sarah Lee',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
      });

      const dev2 = makeAgent({
        id: 'jordan-2',
        name: 'Jordan Smith',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
      });

      const junior = makeAgent({
        id: 'casey-junior',
        name: 'Casey Brown',
        role: 'junior-dev',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'developer', // Ambiguous - matches both dev1 and dev2
      });

      agentManager['agents'].set('jordan-1', dev1);
      agentManager['agents'].set('jordan-2', dev2);
      agentManager['agents'].set('casey-junior', junior);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const brokenEdge = graph.edges.find(
        (e) => e.source === 'casey-junior' && e.type === EdgeType.REPORTS_TO_UNRESOLVED
      );

      expect(brokenEdge).toBeDefined();
      expect(brokenEdge?.error).toContain('Ambiguous');
      expect(brokenEdge?.error).toContain('Sarah Lee');
      expect(brokenEdge?.error).toContain('Jordan Smith');
    });

    it('handles mixed ID and role references in same graph', async () => {
      const ceo = makeAgent({
        id: 'ceo-id',
        name: 'CEO Name',
        role: 'ceo',
        type: RoleType.EXECUTIVE,
        contextLevel: ContextLevel.ORGANIZATION,
        status: AgentStatus.AVAILABLE,
      });

      const cto = makeAgent({
        id: 'cto-id',
        name: 'CEO Name',
        role: 'cto',
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'ceo-id', // ID reference
      });

      const dev = makeAgent({
        id: 'dev-id',
        name: 'Dev Name',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'cto', // Role reference
      });

      agentManager['agents'].set('ceo-id', ceo);
      agentManager['agents'].set('cto-id', cto);
      agentManager['agents'].set('dev-id', dev);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const ctoEdge = graph.edges.find(
        (e) => e.source === 'cto-id' && e.type === EdgeType.REPORTS_TO
      );
      const devEdge = graph.edges.find(
        (e) => e.source === 'dev-id' && e.type === EdgeType.REPORTS_TO
      );

      expect(ctoEdge?.target).toBe('ceo-id'); // ID resolution
      expect(devEdge?.target).toBe('cto-id'); // Role resolution
      expect(ctoEdge?.error).toBeUndefined();
      expect(devEdge?.error).toBeUndefined();
    });

    it('prefers exact ID match over role name when both exist', async () => {
      // Edge case: ID happens to match another agent's role
      const agent1 = makeAgent({
        id: 'manager',
        name: 'Manager Agent',
        role: 'senior-manager',
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
      });

      const agent2 = makeAgent({
        id: 'director',
        name: 'Director Agent',
        role: 'manager', // Role name same as agent1's ID
        type: RoleType.LEADERSHIP,
        contextLevel: ContextLevel.FEATURE,
        status: AgentStatus.AVAILABLE,
      });

      const dev = makeAgent({
        id: 'dev',
        name: 'Dev Agent',
        role: 'developer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        reportsTo: 'manager', // Should resolve to agent1 (exact ID) not agent2 (role)
      });

      agentManager['agents'].set('manager', agent1);
      agentManager['agents'].set('director', agent2);
      agentManager['agents'].set('dev', dev);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      const reportEdge = graph.edges.find(
        (e) => e.source === 'dev' && e.type === EdgeType.REPORTS_TO
      );

      expect(reportEdge?.target).toBe('manager'); // Exact ID match wins
    });
  });

  describe('graph structure validation', () => {
    it('creates nodes for all agents', async () => {
      const agent1 = makeAgent({
        id: 'agent-1',
        name: 'Agent One',
        role: 'role-1',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
      });

      const agent2 = makeAgent({
        id: 'agent-2',
        name: 'Agent Two',
        role: 'role-2',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
      });

      agentManager['agents'].set('agent-1', agent1);
      agentManager['agents'].set('agent-2', agent2);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.find((n) => n.id === 'agent-1')).toBeDefined();
      expect(graph.nodes.find((n) => n.id === 'agent-2')).toBeDefined();
    });

    it('creates no edges when no reporting relationships exist', async () => {
      const agent = makeAgent({
        id: 'solo-agent',
        name: 'Solo Agent',
        role: 'freelancer',
        type: RoleType.INDIVIDUAL_CONTRIBUTOR,
        contextLevel: ContextLevel.TASK,
        status: AgentStatus.AVAILABLE,
        // No reportsTo
      });

      agentManager['agents'].set('solo-agent', agent);
      agentManager['agentsLoaded'] = true;

      const graph = await graphBuilder.buildGraph('hierarchy');

      expect(graph.edges).toHaveLength(0);
    });
  });
});
