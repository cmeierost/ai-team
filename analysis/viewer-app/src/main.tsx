import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchitectureViewer } from '@aspect/viewer';
import type { AnalysisResult } from '@aspect/viewer';

function App() {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-load from public/ if available
  useEffect(() => {
    fetch('/analysis-result.json')
      .then((r) => { if (r.ok) return r.json(); throw new Error('not found'); })
      .then((json: Record<string, unknown>) => {
        const result = (json.result ?? json) as AnalysisResult;
        if (result.summary) setData(result);
      })
      .catch(() => { /* no pre-loaded data, show upload */ });
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      // Accept either raw AnalysisResult or a wrapper with .result
      const result: AnalysisResult = json.result ?? json;
      if (!result.summary) throw new Error('Invalid analysis result: missing summary');
      setData(result);
    } catch (err) {
      setError(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div style={landingStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            🏗️ Architecture Viewer
          </h1>
          <p style={{ color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
            Load an analysis result JSON file to visualize your codebase architecture,
            identify improvement areas, and explore module coupling.
          </p>

          <label style={uploadStyle}>
            <input
              type="file"
              accept=".json"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            {loading ? '⏳ Loading…' : '📂 Choose analysis-result.json'}
          </label>

          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 16 }}>
            Generate with: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
              node generate-data.mjs
            </code>
          </p>

          {error && (
            <p style={{ color: '#ef4444', marginTop: 12, fontSize: 13 }}>{error}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <ArchitectureViewer data={data} />
    </div>
  );
}

const landingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  background: '#f8fafc',
};

const cardStyle: React.CSSProperties = {
  textAlign: 'center',
  maxWidth: 440,
  padding: 40,
  background: '#ffffff',
  borderRadius: 16,
  boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
};

const uploadStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '12px 28px',
  background: '#3b82f6',
  color: '#ffffff',
  borderRadius: 10,
  fontWeight: 600,
  fontSize: 15,
  cursor: 'pointer',
};

createRoot(document.getElementById('root')!).render(<App />);
