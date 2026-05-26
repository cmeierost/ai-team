// @aspect/collector-config — Config and tooling file analysis collector

export { collectConfig } from './config-collector.js';
export type { ConfigCollectorOptions, ConfigCollectionResult } from './config-collector.js';

export { parsePackageJson, parseTsConfig, parseGenericConfig } from './config-parser.js';
export type { ConfigParseResult } from './config-parser.js';
