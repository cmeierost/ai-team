import type { Agent } from '../types';

function createAvatarDataUri(initials: string, fill: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${initials}">
      <rect width="128" height="128" rx="24" fill="${fill}" />
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="42" font-weight="700">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const storyAgents: Record<'adrian' | 'clara' | 'sarah', Agent> = {
  adrian: {
    id: 'adrian-foster',
    name: 'Adrian Foster',
    role: 'Strategic Ecosystem Researcher',
    type: 'cross-concern',
    status: 'available',
    specializations: ['Ecosystem Research', 'Copilot Strategy', 'Architecture Signals'],
    avatar: {
      type: 'url',
      url: createAvatarDataUri('AF', '#2563eb'),
      seed: 'adrian-foster',
    },
  },
  clara: {
    id: 'clara-bishop',
    name: 'Clara Bishop',
    role: 'Frontend Quality Engineer',
    type: 'quality-gate',
    status: 'busy',
    specializations: ['Storybook', 'Browser Checks', 'UI Regression Reporting'],
    avatar: {
      type: 'url',
      url: createAvatarDataUri('CB', '#7c3aed'),
      seed: 'clara-bishop',
    },
  },
  sarah: {
    id: 'sarah-lee',
    name: 'Sarah Lee',
    role: 'Chief Architect',
    type: 'executive',
    status: 'in-meeting',
    specializations: ['Architecture', 'System Design', 'Decision Records'],
  },
};

export const relativeTimestamps = {
  justNow: new Date(Date.now() - 20 * 1000).toISOString(),
  thisHour: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  yesterday: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  lastMonth: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
};
