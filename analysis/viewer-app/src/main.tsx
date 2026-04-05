import React from 'react';
import { createRoot } from 'react-dom/client';
import type { StructuralPipelineResult } from '@aspect/viewer';
import { ArchitectureViewer } from '@aspect/viewer';

const root = createRoot(document.getElementById('root')!);

async function loadData(): Promise<StructuralPipelineResult | null> {
  try {
    const res = await fetch('/analysis-result.json');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function App() {
  const [data, setData] = React.useState<StructuralPipelineResult | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    loadData().then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const handleUpload = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setData(JSON.parse(reader.result as string));
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

  return <ArchitectureViewer data={data} />;
}

root.render(<App />);
