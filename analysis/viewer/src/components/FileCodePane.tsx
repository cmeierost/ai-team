import React from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import type { FileClassificationEntry } from '../types.js';

export interface FileCodePaneProps {
  file?: FileClassificationEntry;
  content?: string;
}

const paneStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: '#1e1e1e',
  color: '#cccccc',
  borderTop: '1px solid #3e3e42',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderBottom: '1px solid #3e3e42',
  background: '#252526',
  fontSize: 12,
};

const messageStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#888888',
  fontSize: 13,
};

function detectLanguage(filePath?: string): string {
  const lower = (filePath ?? '').toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.sh')) return 'bash';
  return 'text';
}

export function FileCodePane({ file, content }: FileCodePaneProps) {
  if (!file) return <div style={messageStyle}>File not found.</div>;
  if (!content) {
    return (
      <div style={paneStyle}>
        <div style={headerStyle}>
          <span>{file.filePath}</span>
          {file.linesOfCode != null && <span>{file.linesOfCode.toLocaleString()} LOC</span>}
        </div>
        <div style={messageStyle}>No code content available for this file.</div>
      </div>
    );
  }

  const language = detectLanguage(file.filePath);
  return (
    <div style={paneStyle}>
      <div style={headerStyle}>
        <span>{file.filePath}</span>
        {file.linesOfCode != null && <span>{file.linesOfCode.toLocaleString()} LOC</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <SyntaxHighlighter
          language={language}
          style={atomOneDark}
          showLineNumbers
          wrapLongLines
          customStyle={{ margin: 0, minHeight: '100%', fontSize: 12, background: '#1e1e1e' }}
          lineNumberStyle={{ color: '#6a9955', minWidth: 34, paddingRight: 10 }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
