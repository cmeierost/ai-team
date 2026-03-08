import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownMessage.css';

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Custom renderers for better control
        code({ node, inline, className, children, ...props }: any) {
          return !inline ? (
            <pre className="code-block">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          ) : (
            <code className="inline-code" {...props}>
              {children}
            </code>
          );
        },
        p({ node, children, ...props }: any) {
          // Prevent <p> from wrapping <pre> elements
          const hasCodeBlock = node.children?.some(
            (child: any) => child.tagName === 'pre' || child.tagName === 'code'
          );
          return hasCodeBlock ? <>{children}</> : <p {...props}>{children}</p>;
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
