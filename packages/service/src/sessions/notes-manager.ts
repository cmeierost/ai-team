import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type ILlmService,
  type INotesManager,
  type INotesRepository,
  type INoteAttachmentReader,
  type Note,
  type NoteAttachment,
  type NoteCreateInput,
  type NoteSessionShare,
  type NoteSessionShareKind,
  type NoteUpdateInput,
} from '@ai-team/core';

export class NotesManager implements INotesManager {
  private readonly notesExportDir: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly notes: INotesRepository,
    private readonly attachmentReader: INoteAttachmentReader,
    private readonly llmService: ILlmService
  ) {
    this.notesExportDir = path.join(this.workspaceRoot, '.ai-team', 'notes');
  }

  async listSessionNotes(sessionId: string): Promise<Note[]> {
    return this.notes.listSessionNotes(sessionId);
  }

  async listDashboardNotes(limit?: number): Promise<Note[]> {
    return this.notes.listDashboardNotes(limit);
  }

  async listAgentNotes(agentId: string): Promise<Note[]> {
    return this.notes.listAgentNotes(agentId);
  }

  async getNote(noteId: string): Promise<Note | null> {
    return this.notes.getNote(noteId);
  }

  async createNote(note: NoteCreateInput): Promise<Note> {
    return this.notes.createNote(note);
  }

  async updateNote(noteId: string, updates: NoteUpdateInput): Promise<Note | null> {
    await this.notes.updateNote(noteId, updates);
    return this.notes.getNote(noteId);
  }

  async deleteNote(noteId: string): Promise<boolean> {
    return this.notes.deleteNote(noteId);
  }

  async exportNoteAsMarkdownAsync(
    noteId: string
  ): Promise<{ markdownPath: string; attachmentPath?: string; attachmentPaths?: string[] } | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const exportDirAbs = this.notesExportDir;
    const filesDirAbs = path.join(exportDirAbs, 'files');
    await fs.mkdir(exportDirAbs, { recursive: true });

    const slug = this.createNoteSlug(note);
    const noteBaseName = `${slug}-${note.id.slice(0, 8)}`;
    const markdownAbsPath = path.join(exportDirAbs, `${noteBaseName}.md`);

    const attachments = note.attachments ?? (note.attachment ? [note.attachment] : []);
    const updatedAttachments: NoteAttachment[] = [];
    const linkedAttachments: Array<{ attachment: NoteAttachment; markdownLink: string }> = [];

    for (const attachment of attachments) {
      const attachmentRelPath = this.normalizeWorkspaceRelativePath(attachment.filePath);
      const inIgnoredPrivateFolder = attachmentRelPath.startsWith('.ai-team/private/');

      let finalAttachmentRelPath = attachmentRelPath;
      if (inIgnoredPrivateFolder) {
        const sourceAbsPath = path.join(this.workspaceRoot, attachmentRelPath);
        const safeOriginalName = this.sanitizeFileName(attachment.fileName || 'attachment');
        const movedFileName = `${noteBaseName}-${attachment.id}-${safeOriginalName}`;
        const targetAbsPath = path.join(filesDirAbs, movedFileName);

        await this.moveFileAsync(sourceAbsPath, targetAbsPath);

        finalAttachmentRelPath = this.normalizeWorkspaceRelativePath(
          path.relative(this.workspaceRoot, targetAbsPath)
        );
      }

      const updatedAttachment: NoteAttachment = {
        ...attachment,
        filePath: finalAttachmentRelPath,
      };
      updatedAttachments.push(updatedAttachment);
      linkedAttachments.push({
        attachment: updatedAttachment,
        markdownLink: this.normalizeWorkspaceRelativePath(
          path.relative(
            path.dirname(markdownAbsPath),
            path.join(this.workspaceRoot, finalAttachmentRelPath)
          )
        ),
      });
    }

    if (updatedAttachments.length > 0) {
      await this.notes.setNoteAttachmentsAsync(note.id, updatedAttachments);
    }

    const noteTitle = note.title?.trim() || `Note ${note.id.slice(0, 8)}`;
    const sessionLine = note.sessionId ? `- **Session:** ${note.sessionId}` : '';
    const compactedSection = note.compactedContent
      ? `\n## Compacted Content\n\n${note.compactedContent}`
      : '';
    const linkedFilesSection =
      linkedAttachments.length > 0
        ? `\n## Linked Files\n\n${linkedAttachments
            .map((la) => {
              const base = `- [${la.attachment.fileName}](${la.markdownLink})`;
              return la.attachment.description ? `${base}\n  - ${la.attachment.description}` : base;
            })
            .join('\n')}`
        : '';

    const content = [
      noteTitle,
      '',
      `- **Agent:** ${note.agentId}`,
      sessionLine,
      `- **Created:** ${note.createdAt}`,
      `- **Updated:** ${note.updatedAt}`,
      '',
      '## Content',
      '',
      note.content || '',
      compactedSection,
      linkedFilesSection,
    ]
      .filter(Boolean)
      .join('\n');

    await fs.writeFile(markdownAbsPath, `${content}\n`, 'utf-8');

    return {
      markdownPath: this.normalizeWorkspaceRelativePath(
        path.relative(this.workspaceRoot, markdownAbsPath)
      ),
      attachmentPath: updatedAttachments[0]?.filePath,
      attachmentPaths: updatedAttachments.map((attachment) => attachment.filePath),
    };
  }

  async summarizeWebsiteNoteAsync(
    noteId: string,
    websiteUrl: string,
    maxPages = 5,
    maxWords = 200,
    focusInstruction?: string,
    generateTitle = false
  ): Promise<Note | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const normalizedUrl = this.normalizeWebsiteUrl(websiteUrl);
    const safeMaxPages = Math.max(1, Math.min(20, maxPages));
    const pages = await this.crawlWebsiteAsync(normalizedUrl, safeMaxPages);

    if (pages.length === 0) {
      throw new Error('Could not crawl readable pages from the provided website URL.');
    }

    const sourceText = this.buildWebsiteSourceText(pages);
    const summary = await this.summarizeHierarchicalAsync(sourceText, maxWords, focusInstruction);

    const urlSections: string[] = [this.buildCompactedSection('summary of the text', summary)];
    for (const [index, page] of pages.entries()) {
      const pageSummary = await this.summarizeHierarchicalAsync(
        `URL: ${page.url}\nTitle: ${page.title || 'n/a'}\n\n${page.text}`,
        Math.max(80, Math.floor(maxWords / 2)),
        focusInstruction
      );
      urlSections.push(
        this.buildCompactedSection(`url ${index + 1}`, pageSummary, {
          label: page.title || page.url,
          url: page.url,
        })
      );
    }

    const notesSection = this.buildWebsiteNotesSection(normalizedUrl, pages, focusInstruction);
    const existingContent = note.content?.trim();
    const combinedContent = existingContent
      ? `${existingContent}\n\n---\n\n${notesSection}`
      : notesSection;

    await this.notes.updateNote(noteId, {
      content: combinedContent,
      compactedContent: urlSections.join('\n\n').trim(),
    });

    const updatedNote = await this.notes.getNote(noteId);
    if (!updatedNote) {
      return null;
    }

    if (!generateTitle) {
      return updatedNote;
    }

    return this.generateNoteTitleAsync(noteId, updatedNote, focusInstruction);
  }

  async compactNoteAsync(
    noteId: string,
    maxWords = 200,
    focusInstruction?: string,
    generateTitle = false
  ): Promise<Note | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const attachments = this.getNoteAttachments(note);
    const hasAttachment = attachments.length > 0;
    const contentLines = note.content.split('\n').length;
    if (!hasAttachment && contentLines <= 10) {
      if (!generateTitle) {
        return note;
      }

      return this.generateNoteTitleAsync(noteId, note, focusInstruction);
    }

    const compactedSections: string[] = [];

    if (note.content.trim()) {
      const titleSection = note.title ? `Title: ${note.title}\n` : '';
      const contentSummary = await this.summarizeHierarchicalAsync(
        `${titleSection}Note content:\n${note.content}`,
        maxWords,
        focusInstruction
      );
      compactedSections.push(this.buildCompactedSection('summary of the text', contentSummary));
    }

    for (const [index, attachment] of attachments.entries()) {
      const summary = await this.summarizeAttachmentAsync(
        note,
        attachment,
        maxWords,
        focusInstruction
      );
      const headingPrefix = this.attachmentReader.isImageAttachment(attachment) ? 'image' : 'file';
      const sectionHeading = `${headingPrefix} ${index + 1}`;
      compactedSections.push(
        this.buildCompactedSection(sectionHeading, summary, {
          label: attachment.fileName,
          url: this.normalizeWorkspaceRelativePath(attachment.filePath),
        })
      );
    }

    const compactedContent = compactedSections.join('\n\n');
    await this.notes.updateNote(noteId, { compactedContent: compactedContent.trim() });
    const updatedNote = await this.notes.getNote(noteId);
    if (!updatedNote) {
      return null;
    }

    if (!generateTitle) {
      return updatedNote;
    }

    return this.generateNoteTitleAsync(noteId, updatedNote, focusInstruction);
  }

  async generateNoteTitleForNoteAsync(
    noteId: string,
    focusInstruction?: string
  ): Promise<Note | null> {
    return this.generateNoteTitleAsync(noteId, undefined, focusInstruction);
  }

  async listNoteSessionSharesAsync(sessionId: string): Promise<NoteSessionShare[]> {
    try {
      return await this.notes.listNoteSessionSharesBySessionAsync(sessionId);
    } catch {
      return [];
    }
  }

  async setNoteAnchorAsync(
    sessionId: string,
    noteId: string,
    anchorMessageId: number,
    kind: NoteSessionShareKind,
    fromMessageId?: number,
    toMessageId?: number
  ): Promise<void> {
    await this.notes.updateNoteSessionShareAsync(noteId, sessionId, {
      anchorMessageId,
      kind,
      active: true,
      fromMessageId: fromMessageId ?? null,
      toMessageId: toMessageId ?? null,
    });
  }

  async deactivateNoteShareAsync(sessionId: string, noteId: string): Promise<void> {
    await this.notes.updateNoteSessionShareAsync(noteId, sessionId, { active: false });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private normalizeWorkspaceRelativePath(relPath: string): string {
    return relPath.replaceAll('\\', '/');
  }

  private sanitizeFileName(name: string): string {
    return name.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  }

  private createNoteSlug(note: Note): string {
    const base = (note.title || `note-${note.id.slice(0, 8)}`).trim().toLowerCase();
    const slug = base
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, 64);
    return slug || `note-${note.id.slice(0, 8)}`;
  }

  private async moveFileAsync(sourceAbsPath: string, targetAbsPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
    try {
      await fs.rename(sourceAbsPath, targetAbsPath);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'EXDEV') {
        throw error;
      }
    }

    await fs.copyFile(sourceAbsPath, targetAbsPath);
    await fs.rm(sourceAbsPath, { force: true });
  }

  private buildSummaryInstructionText(maxWords: number, focusInstruction?: string): string {
    const focus = focusInstruction?.trim();
    const focusSection = focus ? `\nFocus guidance: ${focus}\n` : '';
    return (
      `Produce a compact Markdown summary that is clearly shorter than the source. ` +
      `Write at most ${maxWords} words and avoid repeating source wording verbatim. ` +
      `Keep only key facts, decisions, risks, and action items. ` +
      `Drop examples, repetition, and filler text. ` +
      `Use bullet points only when listing multiple distinct items. ` +
      focusSection
    );
  }

  private getNoteAttachments(note: Note): NoteAttachment[] {
    return note.attachments ?? (note.attachment ? [note.attachment] : []);
  }

  private normalizeSummaryHeading(heading: string): string {
    const normalized = heading.replaceAll(/\r?\n+/g, ' ').trim();
    return normalized.length > 0 ? normalized : 'Summary';
  }

  private buildCompactedSection(
    heading: string,
    body: string,
    link?: { label: string; url: string }
  ): string {
    const normalizedHeading = this.normalizeSummaryHeading(heading);
    const normalizedBody = body.trim();
    const lines = [`[${normalizedHeading}]`];
    if (link) {
      lines.push(`- [${link.label}](${link.url})`);
    }
    lines.push('', normalizedBody);
    return lines.join('\n');
  }

  private async describeImageAttachmentAsync(
    note: Note,
    attachment: NoteAttachment,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const dataUrl = await this.attachmentReader.readAttachmentAsDataUrlAsync(attachment);
    const prompt = [
      `Describe this image in Markdown with at most ${maxWords} words.`,
      'Focus on visible text, structure, layout, diagram relationships, and key signals.',
      note.title ? `Note title: ${note.title}` : null,
      attachment.description ? `Attachment description: ${attachment.description}` : null,
      focusInstruction?.trim() ? `Focus guidance: ${focusInstruction.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return this.llmService.rawChat(
      'You describe images for compact note context. Return concise Markdown only.',
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        } as any,
      ],
      {
        maxTokens: Math.max(500, maxWords * 6),
      }
    );
  }

  private async summarizeAttachmentAsync(
    note: Note,
    attachment: NoteAttachment,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    if (this.attachmentReader.isImageAttachment(attachment)) {
      return this.describeImageAttachmentAsync(note, attachment, maxWords, focusInstruction);
    }

    const sourceTextPreamble = [
      note.title ? `Note title: ${note.title}` : null,
      `Attachment name: ${attachment.fileName}`,
      attachment.description ? `Attachment description: ${attachment.description}` : null,
      '',
      'Attachment content:',
    ]
      .filter(Boolean)
      .join('\n');

    const attachmentText = await this.attachmentReader.extractAttachmentContentAsync(attachment);
    const sourceText = `${sourceTextPreamble}\n${attachmentText}`;

    return this.summarizeHierarchicalAsync(sourceText, maxWords, focusInstruction);
  }

  private async summarizeTextAsync(
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const systemPrompt =
      'You produce compact Markdown summaries that are clearly shorter than the source. Return concise Markdown only.';
    const prompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Source:\n${sourceText}`;
    return this.llmService.rawChat(systemPrompt, [{ role: 'user', content: prompt }], {
      maxTokens: Math.max(220, maxWords * 3),
    });
  }

  private async summarizeHierarchicalAsync(
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const chunks = this.attachmentReader.splitIntoChunks(sourceText, 5000);

    if (chunks.length <= 1) {
      const summary = await this.summarizeTextAsync(sourceText, maxWords, focusInstruction);
      return summary.trim();
    }

    const systemPrompt =
      'You produce compact Markdown summaries that are clearly shorter than the source. Return concise Markdown only.';
    const chunkSummaries: string[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkPrompt =
        `Summarize this section (${index + 1}/${chunks.length}) of a larger document. ` +
        `Keep this section summary concise (45-80 words) and strictly shorter than this section. ` +
        `Focus on facts, decisions, and actions.` +
        (focusInstruction?.trim() ? `\nFocus guidance: ${focusInstruction.trim()}\n` : '\n') +
        `\nSection:\n${chunks[index]}`;

      const chunkSummary = await this.llmService.rawChat(
        systemPrompt,
        [{ role: 'user', content: chunkPrompt }],
        {
          maxTokens: 420,
        }
      );
      chunkSummaries.push(chunkSummary.trim());
    }

    const finalPrompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Combine these section summaries into one final summary:\n` +
      chunkSummaries.map((summary, index) => `\nSection ${index + 1}:\n${summary}`).join('\n');

    const finalSummary = await this.llmService.rawChat(
      systemPrompt,
      [{ role: 'user', content: finalPrompt }],
      {
        maxTokens: Math.max(260, maxWords * 3),
      }
    );
    return finalSummary.trim();
  }

  private normalizeWebsiteUrl(url: string): string {
    const candidate = url.trim();
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const parsed = new URL(withProtocol);
    parsed.hash = '';
    return parsed.toString();
  }

  private extractHtmlTitle(html: string): string | undefined {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!titleMatch?.[1]) return undefined;
    return titleMatch[1].replaceAll(/\s+/g, ' ').trim() || undefined;
  }

  private extractHtmlLinks(baseUrl: string, html: string): string[] {
    const links: string[] = [];
    const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
    let match = hrefRegex.exec(html);

    while (match) {
      const href = match[1]?.trim();
      if (href) {
        try {
          const resolved = new URL(href, baseUrl);
          if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
            resolved.hash = '';
            links.push(resolved.toString());
          }
        } catch {
          // Ignore invalid URLs from page markup.
        }
      }
      match = hrefRegex.exec(html);
    }

    return links;
  }

  private htmlToPlainText(html: string): string {
    return html
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replaceAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[A-Za-z/!][^>]*>|<>/g, ' ')
      .replaceAll(/&nbsp;/gi, ' ')
      .replaceAll(/&amp;/gi, '&')
      .replaceAll(/&lt;/gi, '<')
      .replaceAll(/&gt;/gi, '>')
      .replaceAll(/\s+/g, ' ')
      .trim();
  }

  private async fetchWebsitePageAsync(url: string): Promise<{
    url: string;
    title?: string;
    text: string;
    links: string[];
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ai-team-note-crawler/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported content type for ${url}: ${contentType || 'unknown'}`);
      }

      const raw = await response.text();
      const title = contentType.includes('text/html') ? this.extractHtmlTitle(raw) : undefined;
      const text = contentType.includes('text/html') ? this.htmlToPlainText(raw) : raw.trim();
      const links = contentType.includes('text/html') ? this.extractHtmlLinks(url, raw) : [];

      return {
        url,
        title,
        text: text.slice(0, 24_000),
        links,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async crawlWebsiteAsync(
    startUrl: string,
    maxPages: number
  ): Promise<Array<{ url: string; title?: string; text: string }>> {
    const normalizedStart = this.normalizeWebsiteUrl(startUrl);
    const startOrigin = new URL(normalizedStart).origin;

    const visited = new Set<string>();
    const queued = new Set<string>([normalizedStart]);
    const queue: string[] = [normalizedStart];
    const pages: Array<{ url: string; title?: string; text: string }> = [];

    while (queue.length > 0 && pages.length < maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl || visited.has(currentUrl)) {
        continue;
      }
      visited.add(currentUrl);

      try {
        const page = await this.fetchWebsitePageAsync(currentUrl);
        if (!page.text) {
          continue;
        }

        pages.push({ url: page.url, title: page.title, text: page.text });

        for (const link of page.links) {
          try {
            const normalizedLink = this.normalizeWebsiteUrl(link);
            if (new URL(normalizedLink).origin !== startOrigin) {
              continue;
            }
            if (visited.has(normalizedLink) || queued.has(normalizedLink)) {
              continue;
            }
            queue.push(normalizedLink);
            queued.add(normalizedLink);
          } catch {
            // Ignore invalid links.
          }
        }
      } catch {
        // Skip failed pages and continue crawling.
      }
    }

    return pages;
  }

  private buildWebsiteSourceText(
    pages: Array<{ url: string; title?: string; text: string }>
  ): string {
    return pages
      .map((page, index) => {
        const heading = page.title ? `${page.title} (${page.url})` : page.url;
        return `Page ${index + 1}: ${heading}\n${page.text}`;
      })
      .join('\n\n');
  }

  private buildWebsiteNotesSection(
    sourceUrl: string,
    pages: Array<{ url: string; title?: string; text: string }>,
    focusInstruction?: string
  ): string {
    const lines = [
      '## Website Crawl Notes',
      '',
      `- **Source URL:** ${sourceUrl}`,
      `- **Crawled at:** ${new Date().toISOString()}`,
      `- **Pages summarized:** ${pages.length}`,
    ];

    const pageLinks = pages.map((page) => {
      const title = page.title || page.url;
      return `- [${title}](${page.url})`;
    });

    const extraLines = focusInstruction?.trim()
      ? [`- **Focus:** ${focusInstruction.trim()}`, '', '### Pages', '', ...pageLinks]
      : ['', '### Pages', '', ...pageLinks];

    return `${[...lines, ...extraLines].join('\n')}\n`;
  }

  private async generateNoteTitleAsync(
    noteId: string,
    existingNote?: Note,
    focusInstruction?: string
  ): Promise<Note | null> {
    const note = existingNote ?? (await this.notes.getNote(noteId));
    if (!note) {
      return null;
    }

    const source = [note.compactedContent?.trim(), note.content?.trim()]
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join('\n\n');

    if (!source) {
      return note;
    }

    try {
      const focus = focusInstruction?.trim();
      const clippedSource = source.slice(0, 8000);

      const systemPrompt =
        'You generate concise, specific note titles. Always reason over the user focus instruction first (if provided), then ground the title in the note content. Return only the title.';
      const userPrompt = [
        'Create one short note title (3-8 words).',
        '- Prefer concrete nouns from the note content.',
        '- If a focus instruction is provided, prioritize it.',
        '- Avoid generic titles like "Create Conversation Title".',
        '- No quotes, no punctuation suffix, title only.',
        '',
        `Focus instruction: ${focus && focus.length > 0 ? focus : '(none)'}`,
        '',
        'Note content:',
        clippedSource,
      ].join('\n');

      const generated = await this.llmService.rawChat(
        systemPrompt,
        [{ role: 'user', content: userPrompt }],
        {
          temperature: 0.2,
          maxTokens: 24,
        }
      );

      const normalized = this.normalizeTitle(generated);
      if (!normalized) {
        return note;
      }

      await this.notes.updateNote(noteId, { title: normalized });
      return this.notes.getNote(noteId);
    } catch (error) {
      console.warn('[NotesManager] Note title generation failed, leaving current title.', error);
      return note;
    }
  }

  private normalizeTitle(input: string | undefined | null): string {
    if (!input) return '';
    let result = input
      .replaceAll(/[\r\n\t]+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();

    while (result.startsWith("'") || result.startsWith('"')) {
      result = result.slice(1);
    }
    while (result.endsWith("'") || result.endsWith('"')) {
      result = result.slice(0, -1);
    }
    return result;
  }
}
