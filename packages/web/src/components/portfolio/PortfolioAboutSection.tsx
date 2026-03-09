import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownEditor, PortfolioSectionCard, stripAvatarLine } from './portfolioShared';

interface PortfolioAboutSectionProps {
  isEditing: boolean;
  markdown?: string;
  onMarkdownChange?: (value: string) => void;
}

export function PortfolioAboutSection({ isEditing, markdown, onMarkdownChange }: Readonly<PortfolioAboutSectionProps>) {
  const bio = stripAvatarLine(markdown);

  return (
    <PortfolioSectionCard title="About" icon="📝">
      {isEditing ? (
        <MarkdownEditor value={bio} onChange={(value) => onMarkdownChange?.(value)} />
      ) : bio ? (
        <div className="portfolio-bio">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{bio}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-muted">No bio written yet.</p>
      )}
    </PortfolioSectionCard>
  );
}
