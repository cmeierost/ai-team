import { Agent } from '../types';
import { getAvatarUrl, getAgentInitials } from '../utils/avatar';
import { getAgentColor } from '../utils/color';
import './Avatar.css';

interface AvatarProps {
  agent: Agent | null | undefined;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function Avatar({ agent, size = 'medium', className = '' }: AvatarProps) {
  const avatarUrl = agent ? getAvatarUrl(agent) : null;
  const initials = agent ? getAgentInitials(agent) : '?';
  const agentColor = agent ? getAgentColor(agent) : '#4CAF50';

  const sizeClass = `avatar-${size}`;

  if (avatarUrl) {
    return (
      <div 
        className={`avatar ${sizeClass} ${className}`}
        style={{ '--agent-color': agentColor } as React.CSSProperties}
      >
        <img
          src={avatarUrl}
          alt={agent?.name || 'Avatar'}
          onError={(e) => {
            // Fallback to initials if image fails to load
            const target = e.target as HTMLImageElement;
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = initials;
              parent.classList.add('avatar-initials');
            }
          }}
        />
      </div>
    );
  }

  return (
    <div 
      className={`avatar avatar-initials ${sizeClass} ${className}`}
      style={{ '--agent-color': agentColor } as React.CSSProperties}
    >
      {initials}
    </div>
  );
}
