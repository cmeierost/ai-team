/**
 * Length-prefixed binary framing codec for JSON messages over stdio.
 *
 * Wire format: [4-byte big-endian uint32 length] [UTF-8 JSON payload]
 */

export const HEADER_SIZE = 4;
export const MAX_PAYLOAD_SIZE = 64 * 1024 * 1024; // 64 MB safety limit

/**
 * Encode a message into a length-prefixed binary frame.
 *
 * @returns Buffer containing `[uint32 BE payload length][UTF-8 JSON payload]`
 */
export function encodeFrame(message: unknown): Buffer {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Stateful streaming decoder for length-prefixed JSON frames.
 *
 * Handles partial reads — messages may arrive in arbitrary chunks.
 */
export class FrameDecoder {
  private buffer: Buffer;

  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Push incoming data and return any complete decoded messages.
   */
  push(data: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const results: unknown[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const payloadLength = this.buffer.readUInt32BE(0);

      if (payloadLength > MAX_PAYLOAD_SIZE) {
        throw new Error(
          `Frame payload length ${payloadLength} exceeds MAX_PAYLOAD_SIZE (${MAX_PAYLOAD_SIZE} bytes)`,
        );
      }

      const frameSize = HEADER_SIZE + payloadLength;
      if (this.buffer.length < frameSize) {
        break; // need more data for payload
      }

      const payloadBuf = this.buffer.subarray(HEADER_SIZE, frameSize);
      const jsonStr = payloadBuf.toString('utf-8');

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (err) {
        const preview = jsonStr.slice(0, 100);
        throw new Error(
          `Invalid JSON in frame (payload length ${payloadLength}): ${
            err instanceof Error ? err.message : String(err)
          } — payload starts with: ${JSON.stringify(preview)}`,
        );
      }

      results.push(parsed);
      this.buffer = this.buffer.subarray(frameSize);
    }

    return results;
  }

  /** Reset internal state, discarding any buffered data. */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /** Number of buffered bytes not yet decoded. */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}
