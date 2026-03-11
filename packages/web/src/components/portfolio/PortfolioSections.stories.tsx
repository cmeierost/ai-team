import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Agent, AgentCapabilities, AgentSkill } from '../../types';
import { PortfolioHeader } from './PortfolioHeader';
import { PortfolioIdentitySection } from './PortfolioIdentitySection';
import { PortfolioAboutSection } from './PortfolioAboutSection';
import { PortfolioGoalBackstorySection } from './PortfolioGoalBackstorySection';
import { PortfolioPersonalitySection } from './PortfolioPersonalitySection';
import { PortfolioHierarchySection } from './PortfolioHierarchySection';
import { PortfolioSkillsFeaturesSection } from './PortfolioSkillsFeaturesSection';
import { PortfolioAgentSkillsSection } from './PortfolioAgentSkillsSection';
import { PortfolioSkillAssignmentsSection } from './PortfolioSkillAssignmentsSection';
import { PortfolioAgentCapabilitiesSection } from './PortfolioAgentCapabilitiesSection';
import { PortfolioToolsPermissionsSection } from './PortfolioToolsPermissionsSection';
import { PortfolioCapabilitiesSection } from './PortfolioCapabilitiesSection';
import { PortfolioLlmSection } from './PortfolioLlmSection';
import { PortfolioFileAccessSection } from './PortfolioFileAccessSection';
import { PortfolioActivitySection } from './PortfolioActivitySection';

const sampleAgent: Agent = {
  id: 'daniel-navarro',
  name: 'Daniel Navarro',
  role: 'Frontend Lead',
  type: 'team-lead',
  contextLevel: 'feature',
  status: 'available',
  pronouns: 'he/him',
  timezone: 'Europe/Berlin',
  goal: 'Keep the web package maintainable as the UI surface grows.',
  backstory: 'Leads frontend architecture with a bias for dumb views and testable state seams.',
  markdown: '## About\n\nBuilds maintainable React features, keeps views dumb, and partners closely with Storybook quality workflows.',
  personality: {
    communication_style: 'analytical',
    expertise_level: 'senior',
    mentoring: true,
  },
  reportsTo: 'sarah-lee',
  features: ['Storybook-friendly components', 'React architecture'],
  specializations: ['TanStack Query', 'Zustand boundaries', 'Component decomposition'],
  llm: {
    provider: 'openai-compatible',
    model: 'gpt-5.4',
  },
  createdAt: '2026-02-12T10:00:00.000Z',
  lastInteraction: '2026-03-09T08:30:00.000Z',
  conversationCount: 24,
};

const manager: Agent = {
  id: 'sarah-lee',
  name: 'Sarah Lee',
  role: 'Chief Architect',
  status: 'busy',
};

const directReports: Agent[] = [
  {
    id: 'samuel-ceeses',
    name: 'Samuel Ceeses',
    role: 'UI Styling Specialist',
    status: 'available',
  },
  {
    id: 'clara-bishop',
    name: 'Clara Bishop',
    role: 'Frontend Quality Engineer',
    status: 'busy',
  },
];

const sampleAgentSkills: AgentSkill[] = [
  {
    id: 'skill-1',
    name: 'Frontend architecture review',
    description: 'Review React boundaries, state placement, and component responsibilities.',
    tags: ['react', 'architecture'],
    examples: ['Split a smart TSX file into container and presentational sections.'],
  },
  {
    id: 'skill-2',
    name: 'Storybook readiness',
    description: 'Shape component contracts so they render cleanly with fixture props.',
    tags: ['storybook', 'testing'],
  },
];

const sampleCapabilities: AgentCapabilities = {
  streaming: true,
  multimodal: false,
  codeExecution: true,
  reasoning: true,
};

const sampleLlm = sampleAgent.llm ?? {
  provider: 'openai-compatible',
  model: 'gpt-5.4',
};

const skillAssignments = [
  {
    name: 'frontend-quality-storybook',
    description: 'Keep Storybook useful as a frontend quality surface.',
    assignedToAgent: true,
  },
  {
    name: 'tanstack-query-zustand-boundary',
    description: 'Use the right state tool for each job.',
    assignedToAgent: true,
  },
  {
    name: 'mediated-chat-runtime-store',
    description: 'Refactor live chat runtime behavior safely.',
    assignedToAgent: false,
  },
];

const toolEntries = [
  {
    name: 'read_file',
    description: 'Read file contents from the workspace.',
    allowedForAgent: true,
  },
  {
    name: 'apply_patch',
    description: 'Edit text files using structured patches.',
    allowedForAgent: true,
  },
  {
    name: 'run_in_terminal',
    description: 'Execute workspace commands in a terminal.',
    allowedForAgent: false,
  },
];

const meta: Meta = {
  title: 'Portfolio/Sections',
  decorators: [
    (Story) => (
      <div className="portfolio-story-shell">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Header: Story = {
  render: () => (
    <PortfolioHeader
      agent={sampleAgent}
      isEditing={false}
      saving={false}
      onDraftNameChange={() => undefined}
      onDraftRoleChange={() => undefined}
      onOpenChat={() => undefined}
      onStartEdit={() => undefined}
      onSave={() => undefined}
      onCancel={() => undefined}
      onBack={() => undefined}
    />
  ),
};

export const IdentitySection: Story = {
  render: () => (
    <PortfolioIdentitySection
      type={sampleAgent.type}
      contextLevel={sampleAgent.contextLevel}
      pronouns={sampleAgent.pronouns}
      timezone={sampleAgent.timezone}
      onTypeChange={() => undefined}
      onContextLevelChange={() => undefined}
      onPronounsChange={() => undefined}
      onTimezoneChange={() => undefined}
    />
  ),
};

export const AboutSection: Story = {
  render: () => <PortfolioAboutSection isEditing={false} markdown={sampleAgent.markdown} />, 
};

export const GoalBackstorySection: Story = {
  render: () => <PortfolioGoalBackstorySection isEditing={false} goal={sampleAgent.goal} backstory={sampleAgent.backstory} />,
};

export const PersonalitySection: Story = {
  render: () => <PortfolioPersonalitySection isEditing={false} personality={sampleAgent.personality} />,
};

export const HierarchySection: Story = {
  render: () => (
    <PortfolioHierarchySection
      agentId={sampleAgent.id}
      isEditing={false}
      manager={manager}
      directReports={directReports}
      reportsTo={sampleAgent.reportsTo}
      selectableAgents={[manager, ...directReports, sampleAgent]}
    />
  ),
};

export const SkillsFeaturesSection: Story = {
  render: () => (
    <PortfolioSkillsFeaturesSection
      isEditing={false}
      specializations={sampleAgent.specializations ?? []}
      features={sampleAgent.features ?? []}
    />
  ),
};

export const AgentSkillsSection: Story = {
  render: () => <PortfolioAgentSkillsSection isEditing={false} skills={sampleAgentSkills} />, 
};

export const SkillAssignmentsSection: Story = {
  render: () => (
    <PortfolioSkillAssignmentsSection
      loading={false}
      error={null}
      entries={skillAssignments}
      actionPending={null}
      onToggleSkill={() => undefined}
    />
  ),
};

export const AgentCapabilitiesSection: Story = {
  render: () => <PortfolioAgentCapabilitiesSection isEditing={false} capabilities={sampleCapabilities} />, 
};

export const ToolsPermissionsSection: Story = {
  render: () => (
    <PortfolioToolsPermissionsSection
      loading={false}
      error={null}
      entries={toolEntries}
      actionPending={null}
      onToggleTool={() => undefined}
    />
  ),
};

export const CapabilitiesSection: Story = {
  render: () => <PortfolioCapabilitiesSection isEditing={false} capabilities={sampleCapabilities} />, 
};

export const LlmSection: Story = {
  render: () => <PortfolioLlmSection llm={sampleLlm} />, 
};

export const FileAccessSection: Story = {
  render: () => (
    <PortfolioFileAccessSection>
      <div className="text-muted">Storybook placeholder for file-tree content.</div>
    </PortfolioFileAccessSection>
  ),
};

export const ActivitySection: Story = {
  render: () => (
    <PortfolioActivitySection
      conversationCount={sampleAgent.conversationCount}
      lastInteraction={sampleAgent.lastInteraction}
      createdAt={sampleAgent.createdAt}
    />
  ),
};