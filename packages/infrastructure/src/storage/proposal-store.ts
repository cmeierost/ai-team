import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IProposalStore, IProposalStoreFactory, StoredProposal } from '@ai-team/core';

export class ProposalStore implements IProposalStore {
  private readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, '.ai-team', 'proposals');
  }

  save(proposal: StoredProposal): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dir, `${proposal.proposalId}.json`),
      JSON.stringify(proposal, null, 2),
      'utf8',
    );
  }

  delete(proposalId: string): void {
    try {
      fs.unlinkSync(path.join(this.dir, `${proposalId}.json`));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  loadAll(): StoredProposal[] {
    try {
      const files = fs.readdirSync(this.dir);
      const proposals: StoredProposal[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = fs.readFileSync(path.join(this.dir, file), 'utf8');
          proposals.push(JSON.parse(content) as StoredProposal);
        } catch {
          // skip corrupt files
        }
      }
      return proposals;
    } catch {
      return [];
    }
  }

  load(proposalId: string): StoredProposal | null {
    try {
      const content = fs.readFileSync(path.join(this.dir, `${proposalId}.json`), 'utf8');
      return JSON.parse(content) as StoredProposal;
    } catch {
      return null;
    }
  }
}

export class InfrastructureProposalStoreFactory implements IProposalStoreFactory {
  create(workspaceRoot: string): IProposalStore {
    return new ProposalStore(workspaceRoot);
  }
}
