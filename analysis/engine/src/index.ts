// @aspect/engine — Technology-agnostic code analysis calculation engine

export {
  calculateCyclomatic,
  calculateCognitive,
  calculateHalstead,
  calculateComplexity,
  summarizeFileComplexity,
  type Entity,
  type CyclomaticResult,
  type CognitiveResult,
  type HalsteadMetrics,
  type HalsteadResult,
  type FileComplexitySummary,
  type ComplexityResults,
} from './complexity.js';
