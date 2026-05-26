// @aspect/contracts — Technology-agnostic code analysis contracts
// JSON Schema files are the source of truth; TS types are generated from them.

// Generated types
export * from './generated/index.js';

// Validators
export {
  validateCollectedData,
  validateProtocolMessage,
  getCollectedDataErrors,
  getProtocolMessageErrors,
} from './validators.js';

// Framing
export {
  encodeFrame,
  FrameDecoder,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
} from './framing.js';

