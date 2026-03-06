import * as fs from 'fs';
import * as path from 'path';

export interface StoredProposalFile {
  filePath: string;   // absolute path
  oldContent: string;
  newContent: string;
  additions?: number;
  deletions?: number;
}

export interface StoredProposal {
  proposalId: string;
  agentName: string;
  description: string;
  createdAt: string; // ISO date
  files: StoredProposalFile[];
}

/**
 * Persists code-edit proposals to `.ai-team/proposals/<id>.json`.
 *
 * Used by:
 *  - service layer (chat.ts): save on proposal creation, delete on ack
 *  - api-server (routes/ide.ts): loadAll() on IDE reconnect to replay pending proposals
 *  - cli: save when it directly writes code edits to disk
 */
export class ProposalStore {
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
