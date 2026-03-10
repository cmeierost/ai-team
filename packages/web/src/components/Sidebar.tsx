import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { useRecentSessions } from '../hooks/useRecentSessions';
import { resolveSidebarChatPath } from './sidebarUtils';
import './Sidebar.css';

interface NavItem {
  readonly path: string;
  readonly icon: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly matchPrefix?: string;
}

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const location = useLocation();
  const { agents } = useTeam();
  const { recentSessions } = useRecentSessions(1);

  const chatPath = useMemo(() => resolveSidebarChatPath(recentSessions, agents), [recentSessions, agents]);

  const navItems: NavItem[] = [
    { path: '/', icon: 'home', label: 'Dashboard' },
    { path: '/organization', icon: 'organization', label: 'Organization' },
    { path: '/employees', icon: 'person', label: 'Employees' },
    { path: chatPath ?? '/chat', icon: 'comment', label: 'Chat', disabled: chatPath === null, matchPrefix: '/chat/' },
    { path: '/tasks', icon: 'checklist', label: 'Tasks', disabled: true },
  ];

  return (
    <aside className={`sidebar ${isExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => {
              const matchesPrefix = item.matchPrefix
                ? location.pathname === item.matchPrefix.slice(0, -1) || location.pathname.startsWith(item.matchPrefix)
                : false;
              const active = isActive || matchesPrefix;

              return `sidebar-item ${active ? 'sidebar-item-active' : ''} ${item.disabled ? 'sidebar-item-disabled' : ''}`;
            }}
            onClick={(e) => item.disabled && e.preventDefault()}
            title={isExpanded ? undefined : item.label}
          >
            <i className={`codicon codicon-${item.icon}`}></i>
            {isExpanded && <span className="sidebar-label">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        className="sidebar-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        title={isExpanded ? 'Collapse Sidebar' : 'Expand Sidebar'}
      >
        <i className={`codicon codicon-${isExpanded ? 'chevron-left' : 'chevron-right'}`}></i>
      </button>
    </aside>
  );
}
