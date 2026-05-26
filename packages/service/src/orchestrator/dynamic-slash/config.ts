export interface DynamicSlashCatalogConfigInput {
  promptGlobs?: string[];
  skillGlobs?: string[];
  workflowGlobs?: string[];
}

export function readDynamicSlashCatalogConfig(
  config: unknown
): DynamicSlashCatalogConfigInput | undefined {
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  const value = (config as Record<string, unknown>).dynamicSlashCatalog;
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return value as DynamicSlashCatalogConfigInput;
}
