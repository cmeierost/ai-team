const STORAGE_KEY = 'ai-team.server-connections.v1';
const APP_NAME = 'ai-team-dashboard';

export interface SavedServerConnection {
  url: string;
  workspaces: string[];
  lastUsedAt: string;
}

interface SavedServerConnectionState {
  appName: string;
  connections: SavedServerConnection[];
  selectedUrl?: string;
  selectedByWorkspace: Record<string, string>;
}

function normalizeServerUrl(value: string): string {
  return new URL(value.trim()).toString().replace(/\/$/, '');
}

function createInitialState(): SavedServerConnectionState {
  return {
    appName: APP_NAME,
    connections: [],
    selectedByWorkspace: {},
  };
}

function readState(): SavedServerConnectionState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }

    const parsed = JSON.parse(raw) as Partial<SavedServerConnectionState>;
    return {
      appName: parsed.appName ?? APP_NAME,
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      selectedUrl: parsed.selectedUrl,
      selectedByWorkspace:
        parsed.selectedByWorkspace && typeof parsed.selectedByWorkspace === 'object'
          ? parsed.selectedByWorkspace
          : {},
    };
  } catch {
    return createInitialState();
  }
}

function writeState(state: SavedServerConnectionState): void {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

function upsertConnection(
  state: SavedServerConnectionState,
  url: string,
  workspacePath?: string
): SavedServerConnectionState {
  const now = new Date().toISOString();
  const existing = state.connections.find((entry) => entry.url === url);

  if (existing) {
    const workspaceSet = new Set(existing.workspaces);
    if (workspacePath) {
      workspaceSet.add(workspacePath);
    }
    existing.workspaces = [...workspaceSet];
    existing.lastUsedAt = now;
  } else {
    state.connections.push({
      url,
      workspaces: workspacePath ? [workspacePath] : [],
      lastUsedAt: now,
    });
  }

  state.connections.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  return state;
}

export function getSavedServerConnections(): SavedServerConnection[] {
  return readState().connections;
}

export function getSelectedServerUrl(workspacePath?: string): string | undefined {
  const state = readState();
  if (workspacePath && state.selectedByWorkspace[workspacePath]) {
    return state.selectedByWorkspace[workspacePath];
  }
  return state.selectedUrl;
}

export function saveServerConnection(urlValue: string, workspacePath?: string): string {
  const normalizedUrl = normalizeServerUrl(urlValue);
  const state = readState();
  upsertConnection(state, normalizedUrl, workspacePath);
  writeState(state);
  return normalizedUrl;
}

export function selectServerConnection(urlValue: string, workspacePath?: string): string {
  const normalizedUrl = saveServerConnection(urlValue, workspacePath);
  const state = readState();
  state.selectedUrl = normalizedUrl;
  if (workspacePath) {
    state.selectedByWorkspace[workspacePath] = normalizedUrl;
  }
  writeState(state);
  return normalizedUrl;
}

export function buildUrlWithApiBase(urlValue: string): string {
  const normalizedUrl = normalizeServerUrl(urlValue);
  const currentUrl = new URL(globalThis.location.href);
  currentUrl.searchParams.set('apiBase', normalizedUrl);
  return currentUrl.toString();
}

export function connectToServer(urlValue: string, workspacePath?: string): void {
  const selected = selectServerConnection(urlValue, workspacePath);
  globalThis.location.assign(buildUrlWithApiBase(selected));
}
