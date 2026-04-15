import { IMarkdownSectionService, MarkdownSection, AgentMarkdownParts } from '@ai-team/core';

export class MarkdownSectionService implements IMarkdownSectionService {
  public parseMarkdownSections(markdown: string): MarkdownSection[] {
    if (!markdown || !markdown.trim()) return [];

    const lines = markdown.split(/\r?\n/);
    const sections: MarkdownSection[] = [];
    let currentHeading = '';
    let currentLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^## (.+)$/);
      if (match) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
        });
        currentHeading = match[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    sections.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
    });

    if (sections.length > 0 && sections[0].heading === '' && sections[0].content === '') {
      sections.shift();
    }

    return sections;
  }

  public replaceOrAppendMarkdownSection(
    markdown: string,
    heading: string,
    newContent: string
  ): string {
    const sections = this.parseMarkdownSections(markdown || '');
    const index = sections.findIndex((s) => s.heading === heading);

    if (index >= 0) {
      sections[index] = { heading, content: newContent.trim() };
    } else {
      sections.push({ heading, content: newContent.trim() });
    }

    return this.sectionsToMarkdown(sections);
  }

  public buildAgentMarkdown(parts: AgentMarkdownParts): string {
    const sections: MarkdownSection[] = [];

    if (parts.avatar) {
      sections.push({ heading: '', content: parts.avatar });
    }

    if (parts.introduction) {
      sections.push({ heading: 'Introduction', content: parts.introduction });
    }

    if (parts.personalityProfile && parts.personalityProfile.length > 0) {
      const bullets = parts.personalityProfile.map((line) => `- ${line}`).join('\n');
      sections.push({ heading: 'Personality Profile', content: bullets });
    }

    if (parts.skills && parts.skills.length > 0) {
      const skillParts = parts.skills.map((s) => `### ${s.name}\n\n${s.body}`).join('\n\n');
      sections.push({ heading: 'Skills', content: skillParts });
    }

    if (parts.extraSections) {
      for (const extra of parts.extraSections) {
        sections.push({ heading: extra.heading, content: extra.content.trim() });
      }
    }

    return this.sectionsToMarkdown(sections);
  }

  private sectionsToMarkdown(sections: MarkdownSection[]): string {
    const parts: string[] = [];
    for (const section of sections) {
      if (section.heading === '') {
        if (section.content) parts.push(section.content);
      } else {
        parts.push(`## ${section.heading}\n${section.content}`);
      }
    }

    return parts.join('\n\n') + '\n';
  }
}
