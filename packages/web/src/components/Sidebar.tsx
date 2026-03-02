import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import './Sidebar.css';

interface NavItem {
  readonly path: string;
  readonly icon: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const navItems: NavItem[] = [
  { path: '/', icon: 'home', label: 'Dashboard' },
  { path: '/organization', icon: 'organization', label: 'Organization' },
  { path: '/employees', icon: 'person', label: 'Employees' },
  { path: '/chat', icon: 'comment', label: 'Chat', disabled: true },
  { path: '/tasks', icon: 'checklist', label: 'Tasks', disabled: true },
];

export function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside className={`sidebar ${isExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-item ${isActive ? 'sidebar-item-active' : ''} ${item.disabled ? 'sidebar-item-disabled' : ''}`
            }
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
