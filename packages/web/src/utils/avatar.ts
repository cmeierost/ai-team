import { Agent } from '../types';

const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:3002'
  : window.location.origin;

/**
 * Get the avatar URL for an agent
 * Returns null if no avatar is configured
 */
export function getAvatarUrl(agent: Agent | null | undefined): string | null {
  if (!agent?.avatar?.url) {
    return null;
  }
  
  // If it's a relative path starting with .ai-team/avatars/, convert to API URL
  if (agent.avatar.url.startsWith('.ai-team/avatars/')) {
    const filename = agent.avatar.url.replace('.ai-team/avatars/', '');
    return `${API_BASE}/avatars/${filename}`;
  }
  
  // If it's already a relative path like ../avatars/name.jpg, convert it
  if (agent.avatar.url.startsWith('../avatars/')) {
    const filename = agent.avatar.url.replace('../avatars/', '');
    return `${API_BASE}/avatars/${filename}`;
  }
  
  // If it's an absolute URL, return it as is
  if (agent.avatar.url.startsWith('http://') || agent.avatar.url.startsWith('https://')) {
    return agent.avatar.url;
  }
  
  // Fallback: assume it's a filename
  const filename = agent.avatar.url.split('/').pop() || agent.avatar.url;
  return `${API_BASE}/avatars/${filename}`;
}

/**
 * Get initials from agent name for fallback avatar
 */
export function getAgentInitials(agent: Agent): string {
  const names = agent.name.split(' ');
  if (names.length >= 2) {
    return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
  }
  return agent.name.substring(0, 2).toUpperCase();
}
