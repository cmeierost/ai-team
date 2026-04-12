import React from 'react';
import { createRoot } from 'react-dom/client';
import type { StructuralPipelineResult } from '@aspect/viewer';
import { ArchitectureViewer } from '@aspect/viewer';
import { runStructuralPipeline } from '@aspect/structural';

const root = createRoot(document.getElementById('root')!);

interface ViewerPayload extends StructuralPipelineResult {
  fileContents?: Record<string, string>;
  entities?: Array<{
    id: string;
    kind: string;
    name: string;
    filePath: string;
    parentEntityId?: string | null;
    classification?: {
      isExported?: boolean;
      isTypeOnly?: boolean;
      isConcrete?: boolean;
      visibility?: string | null;
      codeConcern?: 'contract' | 'presentation' | 'logic' | 'unknown';
    };
    rawCounts?: {
      linesOfCode?: number | null;
      parameterCount?: number | null;
      returnStatements?: number | null;
      branchPoints?: number | null;
      publicPropertyCount?: number | null;
      publicMethodCount?: number | null;
      jsxElementCount?: number | null;
    };
  }>;
  relationships?: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    kind: string;
    typeOnly?: boolean;
    crossPackage?: boolean;
    dynamic?: boolean;
  }>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function normalizeViewerRelationships(value: unknown): ViewerPayload['relationships'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((rel): rel is JsonRecord => isRecord(rel))
    .filter((rel) => typeof rel.sourceEntityId === 'string' && typeof rel.targetEntityId === 'string')
    .map((rel) => ({
      sourceEntityId: rel.sourceEntityId as string,
      targetEntityId: rel.targetEntityId as string,
      kind: typeof rel.kind === 'string' ? rel.kind : 'reference',
      typeOnly: rel.typeOnly === true,
      crossPackage: rel.crossPackage === true,
      dynamic: rel.dynamic === true,
    }));
}

function normalizeViewerEntities(value: unknown): ViewerPayload['entities'] {
  if (!Array.isArray(value)) return [];
  return value.filter((entity): entity is NonNullable<ViewerPayload['entities']>[number] => {
    if (!isRecord(entity)) return false;
    return typeof entity.id === 'string'
      && typeof entity.kind === 'string'
      && typeof entity.name === 'string'
      && typeof entity.filePath === 'string';
  });
}

function extractMasterPayload(value: unknown): {
  entities: unknown[];
  relationships: unknown[];
  moduleBoundaries: unknown[];
  fileContents?: Record<string, string>;
} | null {
  const candidates: unknown[] = [value, isRecord(value) ? value.data : undefined];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (!Array.isArray(candidate.entities) || !Array.isArray(candidate.relationships) || !Array.isArray(candidate.moduleBoundaries)) {
      continue;
    }
    return {
      entities: candidate.entities,
      relationships: candidate.relationships,
      moduleBoundaries: candidate.moduleBoundaries,
      fileContents: isStringRecord(candidate.fileContents) ? candidate.fileContents : undefined,
    };
  }
  return null;
}

function buildPayloadFromRaw(raw: unknown): ViewerPayload | null {
  const master = extractMasterPayload(raw);
  if (!master) return null;

  const analyzed = runStructuralPipeline(
    master.entities as Parameters<typeof runStructuralPipeline>[0],
    master.relationships as Parameters<typeof runStructuralPipeline>[1],
    master.moduleBoundaries as Parameters<typeof runStructuralPipeline>[2],
  );
  return {
    ...analyzed,
    fileContents: master.fileContents ?? {},
    entities: normalizeViewerEntities(master.entities),
    relationships: normalizeViewerRelationships(master.relationships),
  };
}

async function loadData(): Promise<ViewerPayload | null> {
  try {
    const res = await fetch('/analysis-result.json');
    if (!res.ok) return null;
    const raw = await res.json();
    return buildPayloadFromRaw(raw);
  } catch {
    return null;
  }
}

function App() {
  const [data, setData] = React.useState<StructuralPipelineResult | null>(null);
  const [fileContents, setFileContents] = React.useState<Record<string, string>>({});
  const [entities, setEntities] = React.useState<ViewerPayload['entities']>([]);
  const [relationships, setRelationships] = React.useState<ViewerPayload['relationships']>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setFileContents(d?.fileContents ?? {});
      setEntities(d?.entities ?? []);
      setRelationships(d?.relationships ?? []);
      setLoading(false);
    });
  }, []);

  const handleUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const next = buildPayloadFromRaw(JSON.parse(reader.result as string));
      setData(next);
      setFileContents(next?.fileContents ?? {});
      setEntities(next?.entities ?? []);
      setRelationships(next?.relationships ?? []);
    };
    reader.readAsText(file);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
        Loading…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, fontFamily: 'system-ui' }}>
        <p style={{ color: '#64748b' }}>No analysis data found. Upload a result file:</p>
        <input type="file" accept=".json" onChange={handleUpload} />
      </div>
    );
  }

  return (
    <ArchitectureViewer
      data={data}
      fileContents={fileContents}
      entities={entities}
      relationships={relationships}
    />
  );
}

root.render(<App />);
