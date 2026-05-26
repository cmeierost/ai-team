declare module 'diff' {
  export interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }

  export interface ParsedDiff {
    oldFileName?: string;
    newFileName?: string;
    oldHeader?: string;
    newHeader?: string;
    hunks: Hunk[];
  }

  export interface ArrayChange<T> {
    value: T[];
    count?: number;
    added?: boolean;
    removed?: boolean;
  }

  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }

  export interface PatchOptions {
    context?: number;
  }

  export function diffChars(oldStr: string, newStr: string): Change[];
  export function diffWords(oldStr: string, newStr: string): Change[];
  export function diffWordsWithSpace(oldStr: string, newStr: string): Change[];
  export function diffLines(oldStr: string, newStr: string): Change[];
  export function diffTrimmedLines(oldStr: string, newStr: string): Change[];
  export function diffSentences(oldStr: string, newStr: string): Change[];
  export function diffCss(oldStr: string, newStr: string): Change[];
  export function diffJson(oldObj: any, newObj: any): Change[];
  export function diffArrays<T>(oldArr: T[], newArr: T[]): ArrayChange<T>[];

  export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions
  ): string;

  export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions
  ): string;

  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions
  ): ParsedDiff;

  export function applyPatch(source: string, uniDiff: string | ParsedDiff): string | false;
  export function applyPatches(uniDiff: string | ParsedDiff[], options: any): void;

  export function parsePatch(uniDiff: string): ParsedDiff[];

  export function convertChangesToDMP(changes: Change[]): any[];
  export function convertChangesToXML(changes: Change[]): string;

  export function canonicalize(obj: any): string;
}
