import type { IDeveloperService } from '@ai-team/api-contracts';
import { getGitUserName, getGitUserEmail, developerNameToId } from '../utils/git.js';

export class DeveloperService implements IDeveloperService {
  async getMe(): Promise<{ id: string; name: string; email?: string }> {
    const name = getGitUserName() || 'Developer';
    const email = getGitUserEmail();
    const id = developerNameToId(name);
    return { id, name, email: email || undefined };
  }
}
