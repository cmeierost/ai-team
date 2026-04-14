import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownMessage.css';

interface MarkdownMessageProps {
  content: string;
  highlightWord?: string | null;
  highlightOccurrence?: number | null;
}

/** Rehype plugin that highlights the Nth occurrence of a word across prose text nodes.
 * Code blocks and inline code are skipped — matching the TTS which strips them. */
function rehypeHighlightWord(word: string, occurrence: number) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');

  return () => (tree: any) => {
    let count = 0;
    let done = false;

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
          continue;
        }
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        let replaced = false;
        while ((match = regex.exec(child.value)) !== null) {
          if (count === occurrence) {
            if (lastIndex < match.index) {
              newChildren.push({ type: 'text', value: child.value.slice(lastIndex, match.index) });
            }
            newChildren.push({
              type: 'element',
              tagName: 'mark',
              properties: { className: ['tts-highlight'] },
              children: [{ type: 'text', value: match[0] }],
            });
            lastIndex = match.index + match[0].length;
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
}: MarkdownMessageProps) {
  const rehypePlugins: any[] = [];
  if (highlightWord && highlightOccurrence != null) {
    rehypePlugins.push(rehypeHighlightWord(highlightWord, highlightOccurrence));
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={rehypePlugins}
      components={{
        // In react-markdown v10, block code renders as <pre><code>, inline code as bare <code>.
        // Override `pre` for block code blocks, and `code` for inline code only.
        pre({ children, ...props }: any) {
          return (
            <pre className="code-block" {...props}>
              {children}
            </pre>
          );
        },
        code({ className, children, ...props }: any) {
          return (
            <code className={className ?? 'inline-code'} {...props}>
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
