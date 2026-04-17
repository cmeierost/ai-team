import matter from 'gray-matter';

export type WorkflowDefinitionScalar = string | number | boolean | null;

export type WorkflowDefinitionValue =
  | WorkflowDefinitionScalar
  | WorkflowDefinitionArray
  | WorkflowDefinitionObject;

export interface WorkflowDefinitionObject {
  [key: string]: WorkflowDefinitionValue | undefined;
}

export interface WorkflowDefinitionArray extends Array<WorkflowDefinitionValue> {}

function unwrapYamlFromFrontmatter(serialized: string): string {
  const trimmed = serialized.trim();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*$/m.exec(trimmed);
  if (!match) {
    throw new Error('Could not extract YAML from serialized frontmatter.');
  }

  return `${match[1].trimEnd()}\n`;
}

export function workflowDefinitionJsonToYaml(definition: object): string {
  const serialized = matter.stringify('', definition);
  return unwrapYamlFromFrontmatter(serialized);
}

export function workflowDefinitionYamlToJson<
  T extends WorkflowDefinitionObject = WorkflowDefinitionObject,
>(yamlText: string): T {
  const wrapped = `---\n${yamlText.trim()}\n---\n`;
  const parsed = matter(wrapped);
  return parsed.data as T;
}
