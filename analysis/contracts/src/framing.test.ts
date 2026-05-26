import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  FrameDecoder,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
} from './framing.js';

describe('encodeFrame', () => {
  it('produces a buffer starting with a 4-byte BE length header', () => {
    const buf = encodeFrame({ ok: true });
    expect(buf.length).toBeGreaterThan(HEADER_SIZE);
    const payloadLen = buf.readUInt32BE(0);
    expect(buf.length).toBe(HEADER_SIZE + payloadLen);
  });
});

describe('FrameDecoder', () => {
  it('round-trips a simple object', () => {
    const decoder = new FrameDecoder();
    const msg = { type: 'invoke', requestId: '1' };
    const results = decoder.push(encodeFrame(msg));
    expect(results).toEqual([msg]);
  });

  it('round-trips unicode content (emoji + CJK)', () => {
    const decoder = new FrameDecoder();
    const msg = { text: '🚀 你好世界 🌍', flag: true };
    const results = decoder.push(encodeFrame(msg));
    expect(results).toEqual([msg]);
  });

  it('round-trips an empty object', () => {
    const decoder = new FrameDecoder();
    const results = decoder.push(encodeFrame({}));
    expect(results).toEqual([{}]);
  });

  it('decodes multiple frames from a single push', () => {
    const decoder = new FrameDecoder();
    const messages = [
      { id: 1, type: 'a' },
      { id: 2, type: 'b' },
      { id: 3, type: 'c' },
    ];
    const combined = Buffer.concat(messages.map(encodeFrame));
    const results = decoder.push(combined);
    expect(results).toEqual(messages);
  });

  it('handles partial reads — split mid-header', () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ hello: 'world' });

    // Split inside the 4-byte header
    const part1 = frame.subarray(0, 2);
    const part2 = frame.subarray(2);

    expect(decoder.push(part1)).toEqual([]);
    expect(decoder.push(part2)).toEqual([{ hello: 'world' }]);
  });

  it('handles partial reads — split mid-payload', () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ key: 'value' });

    const splitPoint = HEADER_SIZE + 3; // inside the JSON payload
    const part1 = frame.subarray(0, splitPoint);
    const part2 = frame.subarray(splitPoint);

    expect(decoder.push(part1)).toEqual([]);
    expect(decoder.push(part2)).toEqual([{ key: 'value' }]);
  });

  it('decodes correctly when data arrives byte-by-byte', () => {
    const decoder = new FrameDecoder();
    const msg = { streaming: true };
    const frame = encodeFrame(msg);

    let results: unknown[] = [];
    for (let i = 0; i < frame.length; i++) {
      results = results.concat(decoder.push(frame.subarray(i, i + 1)));
    }

    expect(results).toEqual([msg]);
  });

  it('has zero pendingBytes after decoding all complete frames', () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ done: true });
    decoder.push(frame);
    expect(decoder.pendingBytes).toBe(0);
  });

  it('reset clears buffered data', () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ data: 'test' });

    // Push partial data
    decoder.push(frame.subarray(0, 3));
    expect(decoder.pendingBytes).toBe(3);

    decoder.reset();
    expect(decoder.pendingBytes).toBe(0);
  });

  it('round-trips a large payload (~1 MB)', () => {
    const decoder = new FrameDecoder();
    const largeArray = Array.from({ length: 50_000 }, (_, i) => ({
      index: i,
      value: `item-${i}`,
    }));
    const msg = { data: largeArray };
    const frame = encodeFrame(msg);

    // Sanity: the frame is at least 1 MB
    expect(frame.length).toBeGreaterThan(1_000_000);

    const results = decoder.push(frame);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(msg);
  });

  it('throws when payload exceeds MAX_PAYLOAD_SIZE', () => {
    const decoder = new FrameDecoder();

    // Craft a header that claims a payload larger than the limit
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(MAX_PAYLOAD_SIZE + 1, 0);

    expect(() => decoder.push(header)).toThrow(/exceeds MAX_PAYLOAD_SIZE/);
  });

  it('throws a meaningful error on invalid JSON payload', () => {
    const decoder = new FrameDecoder();

    const badJson = Buffer.from('not valid json!!!', 'utf-8');
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(badJson.length, 0);

    const frame = Buffer.concat([header, badJson]);

    expect(() => decoder.push(frame)).toThrow(/Invalid JSON in frame/);
    expect(() => {
      decoder.reset();
      decoder.push(frame);
    }).toThrow(/payload starts with/);
  });

  it('handles multiple push cycles — partial then complete', () => {
    const decoder = new FrameDecoder();
    const msg1 = { seq: 1 };
    const msg2 = { seq: 2 };

    const frame1 = encodeFrame(msg1);
    const frame2 = encodeFrame(msg2);
    const combined = Buffer.concat([frame1, frame2]);

    // Push first half (partial msg1)
    const mid = Math.floor(frame1.length / 2);
    const r1 = decoder.push(combined.subarray(0, mid));
    expect(r1).toEqual([]);

    // Push the rest
    const r2 = decoder.push(combined.subarray(mid));
    expect(r2).toEqual([msg1, msg2]);
    expect(decoder.pendingBytes).toBe(0);
  });

  it('handles a zero-length JSON payload', () => {
    const decoder = new FrameDecoder();

    // Zero-length payload → empty string → JSON.parse('') will throw
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(0, 0);

    // An empty string is not valid JSON, so this should throw
    expect(() => decoder.push(header)).toThrow(/Invalid JSON in frame/);
  });
});
