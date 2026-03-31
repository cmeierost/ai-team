import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { PortfolioHeader } from './portfolio/PortfolioHeader';
import { PortfolioIdentitySection } from './portfolio/PortfolioIdentitySection';
import { PortfolioPersonalitySection } from './portfolio/PortfolioPersonalitySection';
import { PortfolioLlmSection } from './portfolio/PortfolioLlmSection';
import { PortfolioMarkdownSections } from './portfolio/PortfolioMarkdownSections';
import { PortfolioHierarchyHandoffsSection } from './portfolio/PortfolioHierarchyHandoffsSection';
import { PortfolioReadFilesSection } from './portfolio/PortfolioReadFilesSection';
import { PortfolioSkillAssignmentsSection } from './portfolio/PortfolioSkillAssignmentsSection';
import { PortfolioToolsPermissionsSection } from './portfolio/PortfolioToolsPermissionsSection';
import { PortfolioFileAccessSection } from './portfolio/PortfolioFileAccessSection';
import { PortfolioActivitySection } from './portfolio/PortfolioActivitySection';
import { PortfolioContextWindowSection } from './portfolio/PortfolioContextWindowSection';
import './Portfolio.css';

// ─── Main Component ──────────────────────────────────────────────────────────

export function Portfolio() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agents, loading, error, client, refresh } = useTeam();

  const agent = agents.find((a) => a.id === agentId);
  const directReports = agents.filter((a) => a.reportsTo === agentId);
  const manager = agents.find((a) => a.id === agent?.reportsTo);

  // ── Tools & skills state ──
  const [toolEntries, setToolEntries] = useState<Array<{ name: string; description: string; group?: string; allowedForAgent?: boolean }>>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolActionPending, setToolActionPending] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [skillEntries, setSkillEntries] = useState<Array<{ name: string; description: string; assignedToAgent?: boolean }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillActionPending, setSkillActionPending] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const loadTools = async (targetAgentId: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setToolsLoading(true);
    }
    setToolsError(null);
    try {
      const response = await client.listTools({ agent: targetAgentId });
      setToolEntries(
        response.entries
          .map((entry) => ({
            name: entry.name,
            description: entry.description,
            group: entry.group,
            allowedForAgent: entry.allowedForAgent,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e: any) {
      setToolsError(e?.message || 'Failed to load tools');
      setToolEntries([]);
    } finally {
      if (!options?.silent) {
        setToolsLoading(false);
      }
    }
  };

  const loadSkills = async (targetAgentId: string) => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await client.searchSkills({ agent: targetAgentId });
      setSkillEntries(
        response.entries
          .map((entry) => ({
            name: entry.name,
            description: entry.description,
            assignedToAgent: entry.assignedToAgent,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e: any) {
      setSkillsError(e?.message || 'Failed to load skills');
      setSkillEntries([]);
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !agent && agentId) navigate('/not-found', { replace: true });
  }, [agent, agentId, loading, navigate]);

  useEffect(() => {
    if (!agentId) return;
    void loadTools(agentId);
    void loadSkills(agentId);
  }, [agentId]);

  if (loading && !agent) return <div className="portfolio-loading"><i className="codicon codicon-loading codicon-modifier-spin" /> Loading portfolio…</div>;
  if (error) return <div className="portfolio-error">Error: {error.message}</div>;
  if (!agentId || !agent) return null;

  // ── Save helpers ──
  const saveAgentFields = async (fields: Record<string, unknown>) => {
    await client.updateAgentFrontmatter(agent.id, fields as any);
    await refresh();
  };

  const handleToggleTool = async (toolName: string, currentlyAllowed: boolean) => {
    if (!agentId || toolActionPending) return;
    const previousEntries = [...toolEntries];

    setToolEntries((prev) =>
      prev.map((entry) =>
        entry.name === toolName
          ? { ...entry, allowedForAgent: !currentlyAllowed }
          : entry,
      ),
    );
    setToolActionPending(toolName);
    setToolsError(null);
    try {
      if (currentlyAllowed) {
        await client.disallowTool({ agent: agentId, tool: toolName });
      } else {
        await client.allowTool({ agent: agentId, tool: toolName });
      }
      await loadTools(agentId, { silent: true });
    } catch (e: any) {
      setToolEntries(previousEntries);
      setToolsError(e?.message || `Failed to ${currentlyAllowed ? 'disallow' : 'allow'} tool`);
    } finally {
      setToolActionPending(null);
    }
  };

  const handleToggleSkill = async (skillName: string, currentlyAssigned: boolean) => {
    if (!agentId || skillActionPending) return;
    setSkillActionPending(skillName);
    setSkillsError(null);
    try {
      if (currentlyAssigned) {
        await client.removeSkill({ agent: agentId, skill: skillName });
      } else {
        await client.addSkill({ agent: agentId, skill: skillName });
      }
      await Promise.all([refresh(), loadSkills(agentId)]);
    } catch (e: any) {
      setSkillsError(e?.message || `Failed to ${currentlyAssigned ? 'remove' : 'add'} skill`);
    } finally {
      setSkillActionPending(null);
    }
  };

  return (
    <div key={agentId} className="portfolio">
      <PortfolioHeader
        agent={agent}
        onOpenChat={() => navigate(`/chat/${agent.id}`)}
        onSave={({ role, avatar }) =>
          saveAgentFields({ role, ...(avatar ? { avatar } : {}) })
        }
        onBack={() => navigate('/employees')}
      />

      <div className="portfolio-content">
        <PortfolioIdentitySection
          type={agent.type}
          contextLevel={agent.contextLevel}
          pronouns={agent.pronouns}
          onSave={(fields) => saveAgentFields(fields as Record<string, unknown>)}
        />

        <PortfolioMarkdownSections
          agentId={agent.id}
          specializations={agent.specializations ?? []}
          client={client}
          onUpdated={refresh}
          onlyHeadings={['Introduction']}
        />

        <PortfolioPersonalitySection
          personality={agent.personality}
          agentId={agent.id}
          client={client}
          onSave={(personality) => saveAgentFields({ personality })}
        />

        <PortfolioLlmSection
          llm={agent.llm}
          onSave={(llm) => saveAgentFields({ llm })}
        />

        <PortfolioMarkdownSections
          agentId={agent.id}
          specializations={agent.specializations ?? []}
          client={client}
          onUpdated={refresh}
          excludeHeadings={['Introduction', 'Handoffs']}
        />

        <PortfolioHierarchyHandoffsSection
          agentId={agent.id}
          manager={manager}
          directReports={directReports}
          reportsTo={agent.reportsTo}
          selectableAgents={agents}
          handoffs={agent.handoffs ?? []}
          allAgents={agents}
          client={client}
          onSaveReportsTo={(reportsTo) => saveAgentFields({ reportsTo })}
          onSaveHandoffs={(handoffs) => saveAgentFields({ handoffs })}
        />

        <PortfolioReadFilesSection
          agentId={agent.id}
          readTheseFilesFirst={agent.readTheseFilesFirst ?? []}
          client={client}
          onSave={(readTheseFilesFirst) => saveAgentFields({ readTheseFilesFirst })}
        />

        <PortfolioSkillAssignmentsSection
          loading={skillsLoading}
          error={skillsError}
          entries={skillEntries}
          actionPending={skillActionPending}
          onToggleSkill={handleToggleSkill}
        />

        <PortfolioToolsPermissionsSection
          loading={toolsLoading}
          error={toolsError}
          entries={toolEntries}
          actionPending={toolActionPending}
          onToggleTool={handleToggleTool}
        />

        <PortfolioFileAccessSection agentId={agent.id} />

        <PortfolioContextWindowSection agent={agent} />

        {(agent.conversationCount !== undefined || agent.lastInteraction || agent.createdAt) ? (
          <PortfolioActivitySection
            conversationCount={agent.conversationCount}
            lastInteraction={agent.lastInteraction}
            createdAt={agent.createdAt}
          />
        ) : null}
      </div>
    </div>
  );
}
