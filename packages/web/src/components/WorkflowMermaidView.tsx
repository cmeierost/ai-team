import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface WorkflowMermaidViewProps {
  definition: string;
}

function sanitizeMermaidDomId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Failed to render Mermaid diagram.';
}

export function WorkflowMermaidView({ definition }: Readonly<WorkflowMermaidViewProps>) {
  const [svgMarkup, setSvgMarkup] = useState('');
  const [loading, setLoading] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const generatedId = useId();
  const renderCounterRef = useRef(0);

  const mermaidBaseId = useMemo(
    () => `workflow-mermaid-${sanitizeMermaidDomId(generatedId)}`,
    [generatedId]
  );

  useEffect(() => {
    let disposed = false;

    const renderDiagramAsync = async () => {
      if (!definition.trim()) {
        setSvgMarkup('');
        setRenderError(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          flowchart: {
            curve: 'linear',
          },
        });

        renderCounterRef.current += 1;
        const renderId = `${mermaidBaseId}-${renderCounterRef.current}`;
        const rendered = await mermaid.render(renderId, definition);

        if (!disposed) {
          setSvgMarkup(rendered.svg);
          setRenderError(null);
        }
      } catch (error) {
        if (!disposed) {
          setRenderError(getErrorMessage(error));
          setSvgMarkup('');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void renderDiagramAsync();

    return () => {
      disposed = true;
    };
  }, [definition, mermaidBaseId]);

  if (loading) {
    return <div className="workflow-definition-loading">Rendering Mermaid diagram…</div>;
  }

  if (renderError) {
    return <div className="workflow-definition-error">{renderError}</div>;
  }

  if (!svgMarkup) {
    return <div className="workflow-definition-loading">No Mermaid diagram available.</div>;
  }

  return (
    <div
      className="workflow-definition-mermaid-rendered"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
