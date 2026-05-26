import { Agent } from './types';

// Mock data for development
// TODO: Replace with API calls to backend server

export const mockAgents: Agent[] = [
  {
    id: 'cto',
    name: 'Alex Chen',
    role: 'Chief Executive Officer',
    status: 'available',
    specializations: ['Architecture', 'Strategy', 'Team Leadership'],
  },
  {
    id: 'tech-lead-frontend',
    name: 'Sarah Johnson',
    role: 'Frontend Tech Lead',
    reportsTo: 'cto',
    status: 'available',
    features: ['UI/UX', 'Dashboard'],
    specializations: ['React', 'TypeScript', 'Design Systems'],
  },
  {
    id: 'tech-lead-backend',
    name: 'Mike Rodriguez',
    role: 'Backend Tech Lead',
    reportsTo: 'cto',
    status: 'busy',
    features: ['API', 'Database'],
    specializations: ['Node.js', 'PostgreSQL', 'Microservices'],
  },
  {
    id: 'senior-dev-1',
    name: 'Emily Wu',
    role: 'Senior Frontend Developer',
    reportsTo: 'tech-lead-frontend',
    status: 'available',
    features: ['Dashboard', 'Components'],
    specializations: ['React', 'CSS', 'Accessibility'],
  },
  {
    id: 'senior-dev-2',
    name: 'David Kim',
    role: 'Senior Backend Developer',
    reportsTo: 'tech-lead-backend',
    status: 'available',
    features: ['API', 'Auth'],
    specializations: ['Express', 'Security', 'Testing'],
  },
  {
    id: 'dev-1',
    name: 'Anna Martinez',
    role: 'Frontend Developer',
    reportsTo: 'senior-dev-1',
    status: 'in-meeting',
    features: ['Components'],
    specializations: ['React', 'Jest'],
  },
  {
    id: 'dev-2',
    name: 'Tom Anderson',
    role: 'Backend Developer',
    reportsTo: 'senior-dev-2',
    status: 'available',
    features: ['Database'],
    specializations: ['SQL', 'Redis'],
  },
  {
    id: 'junior-dev-1',
    name: 'Lisa Park',
    role: 'Junior Developer',
    reportsTo: 'dev-1',
    status: 'available',
    features: ['Components'],
    specializations: ['HTML', 'CSS', 'JavaScript'],
  },
];
