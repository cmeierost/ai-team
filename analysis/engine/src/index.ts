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

export {
  calculateCoupling,
  calculateModuleDependencyMatrix,
  calculateModuleCohesion,
  type CouplingResult,
  type ModuleDependencyMatrix,
  type ModuleCohesion,
  type CouplingOptions,
} from './coupling.js';
