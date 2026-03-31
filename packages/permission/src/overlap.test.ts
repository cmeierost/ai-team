import { describe, expect, it } from 'vitest';
import { analyzePermOverlap } from './overlap.js';
import type { AccessRule } from './rights.js';

function rules(entries: AccessRule[]): AccessRule[] {
  return entries;
}

describe('analyzePermOverlap', () => {
  it('treats write access as overlapping read and list responsibility', () => {
    const report = analyzePermOverlap(new Map([
      ['ethan-carter', rules([{ right: 'write', effect: 'allow', pathPattern: 'packages/core/**/*' }])],
      ['alex-morgan', rules([{ right: 'read', effect: 'allow', pathPattern: 'packages/core/**/*' }])],
    ]));

    expect(report.rights.write.sharedAllowPatterns).toHaveLength(0);
    expect(report.rights.read.sharedAllowPatterns).toEqual([
      {
        pattern: 'packages/core/**/*',
        agentIds: ['alex-morgan', 'ethan-carter'],
        agentCount: 2,
      },
    ]);
    expect(report.rights.list.sharedAllowPatterns).toEqual([
      {
        pattern: 'packages/core/**/*',
        agentIds: ['alex-morgan', 'ethan-carter'],
        agentCount: 2,
      },
    ]);
  });

  it('tracks explicit deny overlap independently from allow overlap', () => {
    const report = analyzePermOverlap(new Map([
      ['maya-patel', rules([{ right: 'delete', effect: 'deny', pathPattern: '.ai-team/private/**/*' }])],
      ['leah-brooks', rules([{ right: 'delete', effect: 'deny', pathPattern: '.ai-team/private/**/*' }])],
    ]));

    expect(report.rights.delete.sharedDenyPatterns).toEqual([
      {
        pattern: '.ai-team/private/**/*',
        agentIds: ['leah-brooks', 'maya-patel'],
        agentCount: 2,
      },
    ]);
    expect(report.rights.delete.sharedAllowPatterns).toHaveLength(0);
  });

  it('calculates pairwise overlap ratios from effective allow patterns', () => {
    const report = analyzePermOverlap(new Map([
      ['daniel-navarro', rules([
        { right: 'write', effect: 'allow', pathPattern: 'packages/web/**/*' },
        { right: 'read', effect: 'allow', pathPattern: 'docs/**/*' },
      ])],
      ['clara-bishop', rules([
        { right: 'read', effect: 'allow', pathPattern: 'packages/web/**/*' },
        { right: 'read', effect: 'allow', pathPattern: 'docs/**/*' },
      ])],
    ]));

    expect(report.rights.read.pairs).toEqual([
      {
        agentA: 'clara-bishop',
        agentB: 'daniel-navarro',
        sharedAllowPatterns: ['docs/**/*', 'packages/web/**/*'],
        sharedDenyPatterns: [],
        agentAEffectiveAllowCount: 2,
        agentBEffectiveAllowCount: 2,
        unionAllowCount: 2,
        overlapRatio: 1,
      },
    ]);
  });
});
