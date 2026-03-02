#!/usr/bin/env node
/**
 * Build-time script to generate JSON schemas from WebSocket TypeScript interfaces.
 * Outputs schemas.json that asyncapi.ts loads at runtime.
 */

import * as TJS from 'typescript-json-schema';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const settings = {
  required: true,
  noExtraProps: false,
  strictNullChecks: false,
};

// Get TypeScript program for chat-handler types
const chatHandlerPath = resolve(__dirname, '../src/ws/chat-handler.ts');
const compilerOptions = {
  strictNullChecks: false,
  esModuleInterop: true,
  skipLibCheck: true,
};

const program = TJS.getProgramFromFiles([chatHandlerPath], compilerOptions, process.cwd());

// Create schema generator
const generator = TJS.buildGenerator(program, settings);

if (!generator) {
  console.error('Failed to create schema generator');
  console.error('Make sure TypeScript source files are available');
  process.exit(1);
}

// Extract schemas from TypeScript interfaces
const chatMessageSchema = generator.getSchemaForSymbol('ChatWebSocketMessage');
const chatEventSchema = generator.getSchemaForSymbol('ChatWebSocketEvent');

if (!chatMessageSchema || !chatEventSchema) {
  console.error('Failed to extract schemas for ChatWebSocketMessage or ChatWebSocketEvent');
  process.exit(1);
}

// Ensure dist directory exists
const distPath = resolve(__dirname, '../dist');
try {
  mkdirSync(distPath, { recursive: true });
} catch (err) {
  // Directory might already exist
}

// Write to dist/ws-schemas.json
const distOutputPath = resolve(distPath, 'ws-schemas.json');
const schemas = {
  ChatWebSocketMessage: chatMessageSchema,
  ChatWebSocketEvent: chatEventSchema,
  generatedAt: new Date().toISOString(),
};

writeFileSync(distOutputPath, JSON.stringify(schemas, null, 2), 'utf-8');
console.log('✓ Generated WebSocket schemas at dist/ws-schemas.json');

// Also copy to src for test purposes
const srcOutputPath = resolve(__dirname, '../src/ws-schemas.json');
writeFileSync(srcOutputPath, JSON.stringify(schemas, null, 2), 'utf-8');
console.log('✓ Copied WebSocket schemas to src/ws-schemas.json for tests');
