export interface ToolDisplayInfo {
  label: string;
  canonicalId: string;
  showCanonicalId: boolean;
}

function toHumanLabel(value: string): string {
  return value.trim().replaceAll(/[_-]+/g, ' ').replaceAll(/\s+/g, ' ').trim();
}

export function getToolDisplayInfo(name: string, group?: string): ToolDisplayInfo {
  const canonicalId = name;

  if (!group) {
    return {
      label: toHumanLabel(name),
      canonicalId,
      showCanonicalId: false,
    };
  }

  const groupPrefix = `${group}_`;
  const shortName = name.startsWith(groupPrefix) ? name.slice(groupPrefix.length) : name;

  const label = toHumanLabel(shortName);
  const showCanonicalId = shortName !== name;

  return {
    label,
    canonicalId,
    showCanonicalId,
  };
}
