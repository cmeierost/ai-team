import { isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import './MarkdownMessage.css';

interface MarkdownMessageProps {
  content: string;
  highlightWord?: string | null;
  highlightOccurrence?: number | null;
  highlightRangeStart?: number | null;
  highlightRangeEnd?: number | null;
  agents?: ReadonlyArray<{ id: string; name: string }>;
  onOpenFile?: (filePath: string) => void;
  onOpenAgentChat?: (agentId: string) => void;
}

type AgentRef = { id: string; name: string };
type PathKind = 'file' | 'directory';

function extractTextContent(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((entry) => extractTextContent(entry)).join('');
  }
  if (node && typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    return extractTextContent((node as { props?: { children?: unknown } }).props?.children);
  }
  return '';
}

let highlightLanguagesRegistered = false;

function ensureHighlightLanguagesRegistered() {
  if (highlightLanguagesRegistered) {
    return;
  }

  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('zsh', bash);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('md', markdown);
  hljs.registerLanguage('plaintext', plaintext);
  hljs.registerLanguage('text', plaintext);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('yml', yaml);

  highlightLanguagesRegistered = true;
}

function extractLanguage(className?: string): string | undefined {
  if (!className) return undefined;
  const match = /language-([\w-]+)/i.exec(className);
  return match?.[1]?.toLowerCase();
}

function highlightCodeAsHtml(rawCode: string, language?: string): string {
  const code = rawCode.replace(/\n$/, '');
  if (!code) {
    return '';
  }

  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }

  return hljs.highlightAuto(code).value;
}

function normalizeInlineToken(text: string): string {
  return text.trim().replaceAll(/^['"`]|['"`]$/g, '');
}

function stripTrailingPunctuation(text: string): string {
  return text.replaceAll(/[),.;:!?]+$/g, '');
}

function getLikelyPathKind(text: string): PathKind | null {
  const candidate = stripTrailingPunctuation(normalizeInlineToken(text));
  if (!candidate || candidate.length < 2) {
    return null;
  }

  if (candidate.endsWith('/') || candidate.endsWith('\\')) {
    return 'directory';
  }

  if (
    /^(?:\.ai-team|\.github|packages|docs|scripts|analysis|research|tools|todo|slides|contracts|benchmarks|file-context|fs-context)(?:[\\/]|$)/i.test(
      candidate
    )
  ) {
    return /\.[a-z0-9]{1,8}$/i.test(candidate) ? 'file' : 'directory';
  }

  if (/^[a-z]:[\\/]/i.test(candidate)) {
    return /\.[a-z0-9]{1,8}$/i.test(candidate) ? 'file' : 'directory';
  }

  if (/^(?:\.\.?[\\/]|~[\\/])/i.test(candidate)) {
    return /\.[a-z0-9]{1,8}$/i.test(candidate) ? 'file' : 'directory';
  }

  if (
    (candidate.includes('/') || candidate.includes('\\')) &&
    /\.[a-z0-9]{1,8}$/i.test(candidate)
  ) {
    return 'file';
  }

  if (candidate.includes('/') || candidate.includes('\\')) {
    return 'directory';
  }

  return null;
}

function toRelativeWorkspacePath(path: string): string {
  return path.replaceAll(/^[a-z]:[\\/]/i, '').replaceAll('\\', '/');
}

function resolveAgentReference(text: string, agents: ReadonlyArray<AgentRef>): AgentRef | null {
  const raw = normalizeInlineToken(text);
  if (!raw) {
    return null;
  }

  const mention = raw.startsWith('@') ? raw.slice(1) : raw;
  const normalized = mention.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    agents.find((agent) => agent.id.toLowerCase() === normalized) ??
    agents.find((agent) => agent.name.toLowerCase() === normalized) ??
    null
  );
}

const WORD_TOKEN_REGEX = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function normalizeWordToken(token: string): string {
  return token.replaceAll('’', "'").toLocaleLowerCase();
}

interface WordMatch {
  word: string;
  start: number;
  end: number;
}

function findWordMatches(text: string, normalizedTarget: string): WordMatch[] {
  const matches: WordMatch[] = [];
  for (const tokenMatch of text.matchAll(WORD_TOKEN_REGEX)) {
    const word = tokenMatch[0];
    const start = tokenMatch.index ?? -1;
    if (start < 0) {
      continue;
    }

    if (normalizeWordToken(word) !== normalizedTarget) {
      continue;
    }

    matches.push({
      word,
      start,
      end: start + word.length,
    });
  }

  return matches;
}

ensureHighlightLanguagesRegistered();

/** Rehype plugin that highlights the Nth occurrence of a word across prose text nodes.
 * Code blocks and inline code are skipped — matching the TTS which strips them. */
function rehypeHighlightWord(
  word: string,
  occurrence: number,
  range?: { start: number; end: number }
) {
  const normalizedTarget = normalizeWordToken(word);

  return () => (tree: any) => {
    let count = 0;
    let done = false;
    let textOffset = 0;

    function walk(node: any, inCode: boolean) {
      if (done || !node.children) return;
      const newChildren: any[] = [];
      for (const child of node.children) {
        // Anything inside <pre> or <code> is skipped — not spoken by TTS
        const childInCode = inCode || child.tagName === 'pre' || child.tagName === 'code';
        if (done || child.type !== 'text') {
          newChildren.push(child);
          if (!done) walk(child, childInCode);
          continue;
        }
        if (inCode) {
          // Inside a code block — don't count or highlight
          newChildren.push(child);
          textOffset += child.value.length;
          continue;
        }

        const wordMatches = findWordMatches(child.value, normalizedTarget);
        if (wordMatches.length === 0) {
          newChildren.push(child);
          textOffset += child.value.length;
          continue;
        }

        let lastIndex = 0;
        let replaced = false;
        for (const match of wordMatches) {
          const globalStart = textOffset + match.start;
          const globalEnd = textOffset + match.end;
          const insideRange = !range || (globalStart >= range.start && globalEnd <= range.end);

          if (!insideRange) {
            continue;
          }

          if (count === occurrence) {
            if (lastIndex < match.start) {
              newChildren.push({ type: 'text', value: child.value.slice(lastIndex, match.start) });
            }
            newChildren.push({
              type: 'element',
              tagName: 'mark',
              properties: { className: ['tts-highlight'] },
              children: [{ type: 'text', value: match.word }],
            });
            lastIndex = match.end;
            done = true;
            replaced = true;
            break;
          }
          count++;
        }

        if (replaced) {
          if (lastIndex < child.value.length) {
            newChildren.push({ type: 'text', value: child.value.slice(lastIndex) });
          }
        } else {
          newChildren.push(child);
        }

        textOffset += child.value.length;
      }
      node.children = newChildren;
    }

    walk(tree, false);
  };
}

export function MarkdownMessage({
  content,
  highlightWord,
  highlightOccurrence,
  highlightRangeStart,
  highlightRangeEnd,
  agents = [],
  onOpenFile,
  onOpenAgentChat,
}: MarkdownMessageProps) {
  const rehypePlugins: any[] = [];
  if (highlightWord && highlightOccurrence != null) {
    const hasScopedRange =
      typeof highlightRangeStart === 'number' &&
      typeof highlightRangeEnd === 'number' &&
      highlightRangeEnd > highlightRangeStart;
    rehypePlugins.push(
      rehypeHighlightWord(
        highlightWord,
        highlightOccurrence,
        hasScopedRange
          ? {
              start: highlightRangeStart,
              end: highlightRangeEnd,
            }
          : undefined
      )
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={{
        // In react-markdown v10, block code renders as <pre><code>, inline code as bare <code>.
        // Override `pre` for block code blocks, and `code` for inline code only.
        pre({ children, ...props }: any) {
          const rawCodeText = extractTextContent(children);
          const codeText = rawCodeText.endsWith('\n') ? rawCodeText.slice(0, -1) : rawCodeText;

          return (
            <div className="code-block-wrap">
              <button
                type="button"
                className="code-block-copy"
                onClick={() => {
                  if (!codeText) {
                    return;
                  }
                  void navigator.clipboard.writeText(codeText).catch(() => {
                    // Clipboard may be unavailable in some browser/security contexts.
                  });
                }}
                title="Copy code"
                aria-label="Copy code"
              >
                <i className="codicon codicon-copy" aria-hidden="true" />
                <span>Copy</span>
              </button>
              <pre className="code-block" {...props}>
                {children}
              </pre>
            </div>
          );
        },
        code({ className, children, ...props }: any) {
          const language = extractLanguage(className);
          const text = String(children ?? '');
          const isLikelyBlockCode = Boolean(language) || text.includes('\n');

          if (isLikelyBlockCode) {
            const highlighted = highlightCodeAsHtml(text, language);
            const hljsClassName = ['hljs', language ? `language-${language}` : '']
              .filter(Boolean)
              .join(' ');

            return (
              <code
                className={hljsClassName}
                dangerouslySetInnerHTML={{ __html: highlighted }}
                {...props}
              />
            );
          }

          const token = stripTrailingPunctuation(normalizeInlineToken(text));
          const pathKind = getLikelyPathKind(token);
          const matchedAgent = resolveAgentReference(token, agents);

          if (onOpenFile && pathKind) {
            return (
              <button
                type="button"
                className="inline-code inline-code-link"
                onClick={() => onOpenFile(toRelativeWorkspacePath(token))}
                title={
                  pathKind === 'directory'
                    ? `Reveal folder in IDE: ${token}`
                    : `Open file in IDE: ${token}`
                }
              >
                <i
                  className={`codicon ${pathKind === 'directory' ? 'codicon-folder' : 'codicon-file'}`}
                  aria-hidden="true"
                />
                <span>{text}</span>
              </button>
            );
          }

          if (onOpenAgentChat && matchedAgent) {
            const label = `@${matchedAgent.id}`;
            return (
              <button
                type="button"
                className="inline-code inline-code-agent"
                onClick={() => onOpenAgentChat(matchedAgent.id)}
                title={`Open chat with ${matchedAgent.name}`}
              >
                {label}
              </button>
            );
          }

          // Inline code: render as plain text (no syntax highlighter spans).
          return (
            <code className={isValidElement(children) ? className : 'inline-code'} {...props}>
              {children}
            </code>
          );
        },
        p({ children, ...props }: any) {
          return <p {...props}>{children}</p>;
        },
        a({ node, children, href, ...props }: any) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
