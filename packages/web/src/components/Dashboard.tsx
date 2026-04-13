import { useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { Logo } from './Logo';
import { Avatar } from './Avatar';
import { useMemo, useEffect, useState } from 'react';
import { TaskStatistics, SystemInfo, ChatSession, Agent } from '../types';
import { getAgentColor } from '../utils/color';
import { API_BASE, hasStartupApiBaseOverride } from '../config/api-base';
import {
  connectToServer,
  getSavedServerConnections,
  selectServerConnection,
} from '../config/server-connections';
import './Dashboard.css';

export function Dashboard() {
  const { agents, loading, client } = useTeam();
  const navigate = useNavigate();
  const [taskStats, setTaskStats] = useState<TaskStatistics | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [recentSessions, setRecentSessions] = useState<ChatSession[]>([]);
  const [savedServerUrls, setSavedServerUrls] = useState<string[]>([]);
  const [selectedServerUrl, setSelectedServerUrl] = useState(API_BASE);
  const [newServerUrl, setNewServerUrl] = useState('');
  const [serverUrlError, setServerUrlError] = useState<string | null>(null);

  // Find CEO (root of hierarchy - no reportsTo)
  const ceoAgent = useMemo(() => {
    if (loading || agents.length === 0) return null;
    const ceo = agents.find((a) => !a.reportsTo);
    return ceo || agents[0]; // Fallback to first agent
  }, [agents, loading]);

  // Find CEO (agent with most direct reports, excluding CEO)
  const topAgent = useMemo(() => {
    if (loading || agents.length === 0 || !ceoAgent) return null;
    const nonCeoAgents = agents.filter((a) => a.id !== ceoAgent.id);
    if (nonCeoAgents.length === 0) return null;

    // Count direct reports for each agent
    const reportCounts = nonCeoAgents.map((agent) => ({
      agent,
      count: agents.filter((a) => a.reportsTo === agent.id).length,
    }));

    // Find agent with most direct reports (create copy before sorting)
    const sorted = [...reportCounts];
    sorted.sort((a, b) => b.count - a.count);
    const top = sorted[0];
    return top.count > 0 ? top.agent : null;
  }, [agents, loading, ceoAgent]);

  // Get recently chatted agents based on session activity
  const recentAgents = useMemo(() => {
    if (loading || agents.length === 0 || recentSessions.length === 0) return [];

    // Get unique agent IDs from recent sessions
    const agentIds = [...new Set(recentSessions.map((s) => s.agentId))].filter(
      (id) => id !== ceoAgent?.id && id !== topAgent?.id
    ); // Exclude CEO and CEO

    // Map to agent objects
    return agentIds
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => a !== undefined)
      .slice(0, 2); // Take 2 most recent
  }, [agents, loading, recentSessions, ceoAgent, topAgent]);

  // Combine featured agents (CEO, CEO, 2 recent)
  const featuredAgents = useMemo(() => {
    const featured: Agent[] = [];
    if (ceoAgent) featured.push(ceoAgent);
    if (topAgent) featured.push(topAgent);
    featured.push(...recentAgents);
    return featured;
  }, [ceoAgent, topAgent, recentAgents]);

  // Fetch task statistics
  useEffect(() => {
    async function fetchTaskStats() {
      try {
        setStatsLoading(true);
        const stats = await client.tasks.dashboard();
        setTaskStats(stats as TaskStatistics);
      } catch (error) {
        console.error('Failed to fetch task statistics:', error);
      } finally {
        setStatsLoading(false);
      }
    }
    fetchTaskStats();
  }, [client]);

  // Fetch system information
  useEffect(() => {
    async function fetchSystemInfo() {
      try {
        const info = await client.system.info();
        setSystemInfo(info as unknown as SystemInfo);
      } catch (error) {
        console.error('Failed to fetch system info:', error);
      }
    }
    fetchSystemInfo();
  }, [client]);

  useEffect(() => {
    const urls = getSavedServerConnections().map((entry) => entry.url);
    setSavedServerUrls(urls);
    if (urls.includes(API_BASE)) {
      setSelectedServerUrl(API_BASE);
    } else if (urls.length > 0) {
      setSelectedServerUrl(urls[0]!);
    }
  }, []);

  useEffect(() => {
    if (!systemInfo?.workspace) {
      return;
    }

    selectServerConnection(API_BASE, systemInfo.workspace);
    const urls = getSavedServerConnections().map((entry) => entry.url);
    setSavedServerUrls(urls);
    setSelectedServerUrl(API_BASE);
  }, [systemInfo]);

  // Fetch recent sessions for dashboard
  useEffect(() => {
    async function fetchRecentSessions() {
      try {
        const sessions = await client.sessions.recent({ limit: 10 });
        setRecentSessions(sessions as ChatSession[]);
      } catch (error) {
        console.error('Failed to fetch recent sessions:', error);
      }
    }
    fetchRecentSessions();
  }, [client]);

  // Calculate agent activity stats
  const agentStats = useMemo(() => {
    if (loading || agents.length === 0) return null;
    const available = agents.filter((a) => a.status === 'available' || !a.status).length;
    const busy = agents.filter((a) => a.status === 'busy').length;
    const offline = agents.filter((a) => a.status === 'offline').length;
    const inMeeting = agents.filter((a) => a.status === 'in-meeting').length;
    return { total: agents.length, available, busy, offline, inMeeting };
  }, [agents, loading]);

  // Calculate open tasks
  const openTasks = useMemo(() => {
    if (!taskStats) return 0;
    const notStarted = taskStats.tasksByStatus?.['not_started'] || 0;
    const inProgress = taskStats.tasksByStatus?.['in_progress'] || 0;
    const blocked = taskStats.tasksByStatus?.['blocked'] || 0;
    return notStarted + inProgress + blocked;
  }, [taskStats]);

  const handleChatWithAgent = (agentId: string) => {
    navigate(`/chat/${agentId}`);
  };

  const handleViewEmployees = () => {
    navigate('/employees');
  };

  const handleConnectSelectedServer = () => {
    setServerUrlError(null);
    try {
      connectToServer(selectedServerUrl, systemInfo?.workspace);
    } catch (error) {
      setServerUrlError(error instanceof Error ? error.message : 'Failed to switch server.');
    }
  };

  const handleAddServer = () => {
    setServerUrlError(null);
    if (!newServerUrl.trim()) {
      return;
    }

    try {
      const normalized = selectServerConnection(newServerUrl, systemInfo?.workspace);
      const urls = getSavedServerConnections().map((entry) => entry.url);
      setSavedServerUrls(urls);
      setSelectedServerUrl(normalized);
      setNewServerUrl('');
    } catch (error) {
      setServerUrlError(error instanceof Error ? error.message : 'Invalid server URL.');
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-container">
        <header className="dashboard-hero">
          <Logo size={80} className="dashboard-logo" />
          <h1 className="dashboard-title">AI Team Management</h1>
          <p className="dashboard-mission">Your virtual software organization</p>
        </header>

        {featuredAgents.length > 0 && (
          <div className="featured-agents">
            {featuredAgents.map((agent) => (
              <button
                key={agent.id}
                className="featured-agent-card"
                style={{ '--agent-color': getAgentColor(agent) } as React.CSSProperties}
                onClick={() => handleChatWithAgent(agent.id)}
              >
                <Avatar agent={agent} size="medium" />
                <div className="featured-agent-info">
                  <h3 className="featured-agent-name">{agent.name}</h3>
                  <span className="agent-role-badge">{agent.role}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="dashboard-stats">
          <button
            className="stat-card stat-card-clickable stat-card-agents"
            onClick={handleViewEmployees}
          >
            <div className="stat-header">
              Agents
              <i className="codicon codicon-arrow-right" />
            </div>
            <div className="stat-content">
              {loading ? (
                <div className="stat-value">—</div>
              ) : (
                <>
                  <div className="stat-value">{agentStats?.total || 0}</div>
                  <div className="stat-breakdown">
                    <span className="stat-item stat-available">
                      {agentStats?.available || 0} available
                    </span>
                    <span className="stat-item stat-busy">{agentStats?.busy || 0} busy</span>
                  </div>
                </>
              )}
            </div>
          </button>

          <div className="stat-card stat-card-tasks">
            <div className="stat-header">Open Tasks</div>
            <div className="stat-content">
              {statsLoading ? (
                <div className="stat-value">—</div>
              ) : (
                <>
                  <div className="stat-value">{openTasks}</div>
                  {taskStats && (
                    <div className="stat-breakdown">
                      <span className="stat-item stat-in-progress">
                        {taskStats.tasksByStatus?.['in_progress'] || 0} in progress
                      </span>
                      <span className="stat-item stat-not-started">
                        {taskStats.tasksByStatus?.['not_started'] || 0} to do
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="stat-card stat-card-completion">
            <div className="stat-header">Completion</div>
            <div className="stat-content">
              {statsLoading ? (
                <div className="stat-value">—</div>
              ) : taskStats && taskStats.totalTasks > 0 ? (
                <>
                  <div className="stat-value">
                    {Math.round(
                      ((taskStats.tasksByStatus?.['completed'] || 0) / taskStats.totalTasks) * 100
                    )}
                    %
                  </div>
                  <div className="stat-breakdown">
                    <span className="stat-item stat-completed">
                      {taskStats.tasksByStatus?.['completed'] || 0} of {taskStats.totalTasks}
                    </span>
                  </div>
                </>
              ) : (
                <div className="stat-value">—</div>
              )}
            </div>
          </div>
        </div>

        <div className="system-info">
          <h2 className="system-info-title">System Information</h2>
          <div className="server-connection-panel">
            <div className="server-connection-panel-header">
              <span>Server Connection</span>
              {!hasStartupApiBaseOverride() && (
                <span className="server-connection-panel-hint">No startup server provided</span>
              )}
            </div>
            <div className="server-connection-controls">
              <select
                className="server-connection-select"
                value={selectedServerUrl}
                onChange={(event) => setSelectedServerUrl(event.target.value)}
              >
                {[...new Set([API_BASE, ...savedServerUrls])].map((url) => (
                  <option key={url} value={url}>
                    {url}
                  </option>
                ))}
              </select>
              <button className="server-connection-button" onClick={handleConnectSelectedServer}>
                Connect
              </button>
            </div>
            <div className="server-connection-controls">
              <input
                className="server-connection-input"
                value={newServerUrl}
                onChange={(event) => setNewServerUrl(event.target.value)}
                placeholder="https://my-server.example:3002"
              />
              <button
                className="server-connection-button server-connection-button-secondary"
                onClick={handleAddServer}
              >
                Save URL
              </button>
            </div>
            {serverUrlError && <div className="server-connection-error">{serverUrlError}</div>}
          </div>
          {systemInfo ? (
            <div className="system-info-grid">
              <div className="info-item">
                <span className="info-label">API URL</span>
                <span className="info-value">{systemInfo.apiUrl}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Workspace</span>
                <span className="info-value" title={systemInfo.workspace}>
                  {systemInfo.workspace.length > 50
                    ? `...${systemInfo.workspace.slice(-50)}`
                    : systemInfo.workspace}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Branch</span>
                <span className="info-value">
                  {systemInfo.branch || <span className="info-empty">not a git repository</span>}
                </span>
              </div>
              {systemInfo.package && (
                <>
                  <div className="info-item">
                    <span className="info-label">Package</span>
                    <span className="info-value">
                      {systemInfo.package.name || <span className="info-empty">unnamed</span>}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Version</span>
                    <span className="info-value">
                      {systemInfo.package.version || (
                        <span className="info-empty">unversioned</span>
                      )}
                    </span>
                  </div>
                  {systemInfo.package.description && (
                    <div className="info-item info-item-full">
                      <span className="info-label">Description</span>
                      <span className="info-value">{systemInfo.package.description}</span>
                    </div>
                  )}
                </>
              )}
              {!systemInfo.package && (
                <div className="info-item">
                  <span className="info-label">Package</span>
                  <span className="info-empty">no package.json found</span>
                </div>
              )}
            </div>
          ) : (
            <div className="server-connection-panel-hint">
              Connect to a server to load workspace and package details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
