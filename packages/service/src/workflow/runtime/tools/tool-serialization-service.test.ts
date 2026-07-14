import { describe, expect, it } from 'vitest';
import { ToolSerializationService } from './tool-serialization-service.js';

describe('ToolSerializationService', () => {
  const service = new ToolSerializationService();

  it('preserves full JSON payloads in previews', () => {
    const payload = { items: [{ id: 1 }, { id: 2 }] };
    const serialized = service.serialise(payload);

    expect(service.formatToolResultPreview(serialized)).toBe(serialized);
  });

  it('truncates long non-JSON previews', () => {
    const longText = 'x'.repeat(400);
    const preview = service.formatToolResultPreview(longText);

    expect(preview.length).toBeLessThanOrEqual(220);
    expect(preview.endsWith('…')).toBe(true);
  });
});
