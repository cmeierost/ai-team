import { Agent } from '../types';
import { getAvatarUrl, getAgentInitials } from '../utils/avatar';
import './Avatar.css';

interface AvatarProps {
  agent: Agent | null | undefined;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function Avatar({ agent, size = 'medium', className = '' }: AvatarProps) {
  const avatarUrl = agent ? getAvatarUrl(agent) : null;
  const initials = agent ? getAgentInitials(agent) : '?';

  const sizeClass = `avatar-${size}`;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={agent?.name || 'Avatar'}
        className={`avatar ${sizeClass} ${className}`}
        onError={(e) => {
          // Fallback to initials if image fails to load
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
          if (target.nextElementSibling) {
            (target.nextElementSibling as HTMLElement).style.display = 'flex';
          }
        }}
      />
    );
  }

  return (
    <div className={`avatar avatar-initials ${sizeClass} ${className}`}>
      {initials}
    </div>
  );
}
