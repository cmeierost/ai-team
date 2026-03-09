import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { Agent, AgentPersonality, AgentCapabilities } from '../types';
import { FileTree } from './FileTree';
import { PortfolioHeader } from './portfolio/PortfolioHeader';
import { PortfolioIdentitySection } from './portfolio/PortfolioIdentitySection';
import { PortfolioAboutSection } from './portfolio/PortfolioAboutSection';
import { PortfolioGoalBackstorySection } from './portfolio/PortfolioGoalBackstorySection';
import { PortfolioPersonalitySection } from './portfolio/PortfolioPersonalitySection';
import { PortfolioHierarchySection } from './portfolio/PortfolioHierarchySection';
import { PortfolioSkillsFeaturesSection } from './portfolio/PortfolioSkillsFeaturesSection';
import { PortfolioAgentSkillsSection } from './portfolio/PortfolioAgentSkillsSection';
import { PortfolioSkillAssignmentsSection } from './portfolio/PortfolioSkillAssignmentsSection';
import { PortfolioAgentCapabilitiesSection } from './portfolio/PortfolioAgentCapabilitiesSection';
import { PortfolioToolsPermissionsSection } from './portfolio/PortfolioToolsPermissionsSection';
import { PortfolioCapabilitiesSection } from './portfolio/PortfolioCapabilitiesSection';
import { PortfolioLlmSection } from './portfolio/PortfolioLlmSection';
import { PortfolioFileAccessSection } from './portfolio/PortfolioFileAccessSection';
import { PortfolioActivitySection } from './portfolio/PortfolioActivitySection';
import './Portfolio.css';

// ─── Main Component ──────────────────────────────────────────────────────────

export function Portfolio() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agents, loading, error, client, refresh } = useTeam();

  const agent = agents.find((a) => a.id === agentId);
  const directReports = agents.filter((a) => a.reportsTo === agentId);
  const manager = agents.find((a) => a.id === agent?.reportsTo);

  // ── Edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Agent>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toolEntries, setToolEntries] = useState<Array<{ name: string; description: string; allowedForAgent?: boolean }>>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolActionPending, setToolActionPending] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [skillEntries, setSkillEntries] = useState<Array<{ name: string; description: string; assignedToAgent?: boolean }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillActionPending, setSkillActionPending] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const loadTools = async (targetAgentId: string) => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const response = await client.listTools({ agent: targetAgentId });
      setToolEntries(
        response.entries
          .map((entry) => ({
            name: entry.name,
            description: entry.description,
            allowedForAgent: entry.allowedForAgent,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e: any) {
      setToolsError(e?.message || 'Failed to load tools');
      setToolEntries([]);
    } finally {
      setToolsLoading(false);
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
    setIsEditing(false);
    setDraft({});
    setSaveError(null);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    void loadTools(agentId);
    void loadSkills(agentId);
  }, [agentId]);

  if (loading) return <div className="portfolio-loading"><i className="codicon codicon-loading codicon-modifier-spin" /> Loading portfolio…</div>;
  if (error) return <div className="portfolio-error">Error: {error.message}</div>;
  if (!agentId || !agent) return null;

  // ── Edit helpers ──
  const startEdit = () => { setDraft({ ...agent }); setSaveError(null); setIsEditing(true); };
  const cancelEdit = () => { setDraft({}); setSaveError(null); setIsEditing(false); };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { markdown: draftMarkdown, id: _id, filePath: _fp, skillPath: _sp, createdAt: _ca,
        lastInteraction: _li, conversationCount: _cc, status: _st, tools: _tools, ...editableFields } = draft as any;
      await client.updateAgentFrontmatter(agent.id, editableFields);
      if (draftMarkdown !== undefined && draftMarkdown !== agent.markdown) {
        await client.updateAgentMarkdown(agent.id, draftMarkdown);
      }
      await refresh();
      setIsEditing(false);
      setDraft({});
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const patchDraft = (fields: Partial<Agent>) => setDraft((d) => ({ ...d, ...fields }));
  const patchPersonality = (fields: Partial<AgentPersonality>) =>
    setDraft((d) => ({ ...d, personality: { ...d.personality, ...fields } }));
  const patchCapabilities = (fields: Partial<AgentCapabilities>) =>
    setDraft((d) => ({ ...d, capabilities: { ...d.capabilities, ...fields } }));

  const handleToggleTool = async (toolName: string, currentlyAllowed: boolean) => {
    if (!agentId || toolActionPending) return;
    setToolActionPending(toolName);
    setToolsError(null);
    try {
      if (currentlyAllowed) {
        await client.disallowTool({ agent: agentId, tool: toolName });
      } else {
        await client.allowTool({ agent: agentId, tool: toolName });
      }
      await Promise.all([refresh(), loadTools(agentId)]);
    } catch (e: any) {
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

  // In edit mode, draft overrides agent for display
  const v: Agent = isEditing ? { ...agent, ...draft } : agent;
  const currentMarkdown = draft.markdown ?? agent.markdown;
  const currentPersonality = draft.personality ?? agent.personality;
  const currentCapabilities = draft.capabilities ?? agent.capabilities;
  const currentLlm = v.llm;
  const shouldShowGoalBackstory = isEditing || Boolean(v.goal || v.backstory);
  const shouldShowPersonality = isEditing || Boolean(v.personality);
  const shouldShowSkillsFeatures = isEditing || Boolean((v.specializations?.length ?? 0) > 0 || (v.features?.length ?? 0) > 0);
  const shouldShowAgentSkills = isEditing || Boolean((v.skills?.length ?? 0) > 0);
  const shouldShowCapabilities = isEditing || Boolean(v.capabilities);
  const shouldShowLlm = !isEditing && Boolean(currentLlm?.provider || currentLlm?.model || currentLlm?.modelKey);
  const shouldShowActivity = !isEditing && Boolean(v.conversationCount !== undefined || v.lastInteraction || v.createdAt);

  return (
    <div className={`portfolio ${isEditing ? 'portfolio-edit-mode' : ''}`}>
      <PortfolioHeader
        agent={v}
        isEditing={isEditing}
        saving={saving}
        draftName={draft.name}
        draftRole={draft.role}
        onDraftNameChange={(value) => patchDraft({ name: value })}
        onDraftRoleChange={(value) => patchDraft({ role: value })}
        onOpenChat={() => navigate(`/chat/${agent.id}`)}
        onStartEdit={startEdit}
        onSave={saveEdit}
        onCancel={cancelEdit}
        onBack={() => navigate('/employees')}
      />

      {saveError && (
        <div className="portfolio-save-error">
          <i className="codicon codicon-error" /> {saveError}
        </div>
      )}

      <div className="portfolio-content">
        {isEditing && (
          <PortfolioIdentitySection
            type={draft.type ?? agent.type}
            contextLevel={draft.contextLevel ?? agent.contextLevel}
            pronouns={draft.pronouns ?? agent.pronouns}
            timezone={draft.timezone ?? agent.timezone}
            onTypeChange={(value) => patchDraft({ type: value })}
            onContextLevelChange={(value) => patchDraft({ contextLevel: value })}
            onPronounsChange={(value) => patchDraft({ pronouns: value })}
            onTimezoneChange={(value) => patchDraft({ timezone: value })}
          />
        )}

        <PortfolioAboutSection
          isEditing={isEditing}
          markdown={currentMarkdown}
          onMarkdownChange={(value) => patchDraft({ markdown: value })}
        />

        {shouldShowGoalBackstory ? (
          <PortfolioGoalBackstorySection
            isEditing={isEditing}
            goal={draft.goal ?? agent.goal}
            backstory={draft.backstory ?? agent.backstory}
            onGoalChange={(value) => patchDraft({ goal: value })}
            onBackstoryChange={(value) => patchDraft({ backstory: value })}
          />
        ) : null}

        {shouldShowPersonality ? (
          <PortfolioPersonalitySection
            isEditing={isEditing}
            personality={currentPersonality}
            onCommunicationStyleChange={(value) => patchPersonality({ communication_style: value })}
            onExpertiseLevelChange={(value) => patchPersonality({ expertise_level: value })}
            onMentoringChange={(value) => patchPersonality({ mentoring: value })}
          />
        ) : null}

        <PortfolioHierarchySection
          agentId={agent.id}
          isEditing={isEditing}
          manager={manager}
          directReports={directReports}
          reportsTo={draft.reportsTo ?? agent.reportsTo}
          selectableAgents={agents}
          onReportsToChange={(value) => patchDraft({ reportsTo: value })}
        />

        {shouldShowSkillsFeatures ? (
          <PortfolioSkillsFeaturesSection
            isEditing={isEditing}
            specializations={draft.specializations ?? agent.specializations ?? []}
            features={draft.features ?? agent.features ?? []}
            onSpecializationsChange={(values) => patchDraft({ specializations: values })}
            onFeaturesChange={(values) => patchDraft({ features: values })}
          />
        ) : null}

        {shouldShowAgentSkills ? (
          <PortfolioAgentSkillsSection
            isEditing={isEditing}
            skills={draft.skills ?? agent.skills ?? []}
            onSkillsChange={(skills) => patchDraft({ skills })}
          />
        ) : null}

        <PortfolioSkillAssignmentsSection
          loading={skillsLoading}
          error={skillsError}
          entries={skillEntries}
          actionPending={skillActionPending}
          onToggleSkill={handleToggleSkill}
        />

        {shouldShowCapabilities ? (
          <PortfolioAgentCapabilitiesSection
            isEditing={isEditing}
            capabilities={currentCapabilities}
            onCapabilityChange={patchCapabilities}
          />
        ) : null}

        <PortfolioToolsPermissionsSection
          loading={toolsLoading}
          error={toolsError}
          entries={toolEntries}
          actionPending={toolActionPending}
          onToggleTool={handleToggleTool}
        />

        {shouldShowCapabilities ? (
          <PortfolioCapabilitiesSection
            isEditing={isEditing}
            capabilities={currentCapabilities}
            onCapabilityChange={patchCapabilities}
          />
        ) : null}

        {shouldShowLlm && currentLlm ? <PortfolioLlmSection llm={currentLlm} /> : null}

        <PortfolioFileAccessSection>
          <FileTree agentId={agent.id} editMode={isEditing} />
        </PortfolioFileAccessSection>

        {shouldShowActivity ? (
          <PortfolioActivitySection
            conversationCount={v.conversationCount}
            lastInteraction={v.lastInteraction}
            createdAt={v.createdAt}
          />
        ) : null}
      </div>
    </div>
  );
}
