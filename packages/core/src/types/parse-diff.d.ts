declare module 'parse-diff' {
  export interface Change {
    type: 'add' | 'del' | 'normal';
    content: string;
    normal?: boolean;
    add?: boolean;
    del?: boolean;
    ln?: number;
    ln1?: number;
    ln2?: number;
  }

  export interface Chunk {
    content: string;
    changes: Change[];
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
  }

  export interface File {
    chunks: Chunk[];
    deletions: number;
    additions: number;
    from?: string;
    to?: string;
    oldMode?: string;
    newMode?: string;
    index?: string[];
    deleted?: boolean;
    new?: boolean;
  }

  export default function parseDiff(diff: string): File[];
}
