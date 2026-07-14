 
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Framed stdio protocol for cross-language communication between aspect clients and collectors. Transport: stdin/stdout with 4-byte big-endian uint32 length prefix followed by UTF-8 JSON payload. Stderr is reserved for diagnostics.
 */
export type AspectProtocolMessage =
  | InvokeMessage
  | ProgressMessage
  | ChunkMessage
  | ResultMessage
  | ErrorMessage
  | CompleteMessage;

/**
 * Client → Collector request to run an analysis method. The 'method' field selects the operation and 'params' carries method-specific arguments.
 */
export interface InvokeMessage {
  /**
   * Semantic version of the framed stdio protocol. Must be '1.0' for this schema revision.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'invoke' for invocation requests.
   */
  type: 'invoke';
  /**
   * Unique identifier that correlates this request with its response messages (progress, chunk, result, error, complete).
   */
  requestId: string;
  /**
   * The analysis method to invoke. Known methods: 'collect' (run aspect collection), 'getCapabilities' (query supported aspects and options).
   */
  method: string;
  /**
   * Method-specific parameters. Shape depends on the 'method' field. For 'collect': includes rootDir, includeAspects, excludeAspects, options. For 'getCapabilities': may be omitted or empty.
   */
  params?: {
    /**
     * Absolute path to the project root directory to analyse.
     */
    rootDir?: string;
    /**
     * If provided, only these aspects will be collected. Null or omitted means collect all available aspects.
     */
    includeAspects?: string[] | null;
    /**
     * Aspects to skip during collection. Null or omitted means no exclusions.
     */
    excludeAspects?: string[] | null;
    /**
     * Tool-specific options forwarded to the collector. Shape is defined by each collector implementation.
     */
    options?: {
      [k: string]: unknown | undefined;
    } | null;
    [k: string]: unknown | undefined;
  };
}
/**
 * Collector → Client status update emitted during collection. Multiple progress messages may be sent per request.
 */
export interface ProgressMessage {
  /**
   * Semantic version of the framed stdio protocol.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'progress' for status updates.
   */
  type: 'progress';
  /**
   * Identifier of the originating invoke request this progress belongs to.
   */
  requestId: string;
  /**
   * Human-readable status message describing what the collector is currently doing.
   */
  message: string;
  /**
   * Estimated completion percentage (0–100). Null when the collector cannot estimate progress.
   */
  percentage?: number | null;
  /**
   * The aspect currently being collected, if applicable. Null when progress is not aspect-specific.
   */
  aspect?: string | null;
}
/**
 * Collector → Client partial data delivery for streaming large results. Each chunk carries items for a single section of CollectedCodeData.
 */
export interface ChunkMessage {
  /**
   * Semantic version of the framed stdio protocol.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'chunk' for partial data delivery.
   */
  type: 'chunk';
  /**
   * Identifier of the originating invoke request this chunk belongs to.
   */
  requestId: string;
  /**
   * Which section of CollectedCodeData this chunk belongs to (e.g. 'entities', 'relationships', 'duplicationSignals').
   */
  section: string;
  /**
   * Array of items for the specified section. Item shape depends on the section type.
   */
  data: unknown[];
  /**
   * Zero-based chunk index within this section. Chunks for the same section arrive in order.
   */
  index: number;
  /**
   * True if this is the last chunk for this section. The client can consider the section complete once a chunk with final=true is received.
   */
  final: boolean;
}
/**
 * Collector → Client final complete result for an invocation. For 'collect' the data is CollectedCodeData; for 'getCapabilities' the data is CapabilitiesResult.
 */
export interface ResultMessage {
  /**
   * Semantic version of the framed stdio protocol.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'result' for final results.
   */
  type: 'result';
  /**
   * Identifier of the originating invoke request this result answers.
   */
  requestId: string;
  /**
   * The complete result payload. Shape depends on the invoked method — CollectedCodeData for 'collect', CapabilitiesResult for 'getCapabilities'.
   */
  data: {
    [k: string]: unknown | undefined;
  };
}
/**
 * Collector → Client error response. Sent when an invocation fails. May be followed by a 'complete' message.
 */
export interface ErrorMessage {
  /**
   * Semantic version of the framed stdio protocol.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'error' for error responses.
   */
  type: 'error';
  /**
   * Identifier of the originating invoke request that failed.
   */
  requestId: string;
  /**
   * Machine-readable error code for programmatic handling.
   */
  code: string;
  /**
   * Human-readable error description suitable for logging or display.
   */
  message: string;
  /**
   * Additional structured error context (stack traces, failed aspect names, etc.). Null when no extra context is available.
   */
  details?: {
    [k: string]: unknown | undefined;
  } | null;
}
/**
 * Collector → Client terminal message. Exactly one 'complete' is sent per requestId after 'result' or 'error'. Signals that no further messages will arrive for this request.
 */
export interface CompleteMessage {
  /**
   * Semantic version of the framed stdio protocol.
   */
  protocolVersion: '1.0';
  /**
   * Message type discriminator. Always 'complete' for terminal acknowledgements.
   */
  type: 'complete';
  /**
   * Identifier of the originating invoke request this completion signals.
   */
  requestId: string;
  /**
   * True if the invocation succeeded (a 'result' was sent), false if it failed (an 'error' was sent).
   */
  success: boolean;
  /**
   * Execution summary. Null when summary information is not available (e.g. for non-collect methods).
   */
  summary?: {
    /**
     * Names of aspects that completed successfully.
     */
    aspectsCompleted: string[];
    /**
     * Names of aspects that failed during collection.
     */
    aspectsFailed: string[];
    /**
     * Total wall-clock duration of the invocation in milliseconds.
     */
    duration: number;
  } | null;
}
