import { describe, expect, it } from 'vitest';
import { getToolDisplayInfo } from './toolDisplay';

describe('getToolDisplayInfo', () => {
  it('shows short label and canonical id for grouped canonical tool names', () => {
    expect(getToolDisplayInfo('hr_performance', 'hr')).toEqual({
      label: 'performance',
      canonicalId: 'hr_performance',
      showCanonicalId: true,
    });
  });

  it('falls back to canonical when grouped name does not include expected prefix', () => {
    expect(getToolDisplayInfo('performance', 'hr')).toEqual({
      label: 'performance',
      canonicalId: 'performance',
      showCanonicalId: false,
    });
  });

  it('formats non-grouped names for display', () => {
    expect(getToolDisplayInfo('tool_run')).toEqual({
      label: 'tool run',
      canonicalId: 'tool_run',
      showCanonicalId: false,
    });
  });
});
