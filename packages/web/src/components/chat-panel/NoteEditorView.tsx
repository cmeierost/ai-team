import {
  useState,
  useEffect,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type CSSProperties,
} from 'react';
import { useSessionNotes } from '../../hooks/useSessionNotes';
import { useTeam } from '../../context/TeamContext';
import { Avatar } from '../Avatar';
import { getAgentColor } from '../../utils/color';
import type { NoteAttachment, NoteAttachmentInput, SessionThread, SessionNode } from '../../types';

interface NoteEditorViewProps {
  /** The note ID to load, or `'new'` to start with an empty note. */
  noteId: string;
  sessionId: string;
  agentId: string;
  onBack: () => void;
  /** Called with the real note ID after a new note is first saved, so the caller can update the URL. */
  onNoteCreated?: (noteId: string) => void;
}

function readFileAsAttachmentAsync(file: File, description?: string): Promise<NoteAttachmentInput> {
  return new Promise<NoteAttachmentInput>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read file as a data URL'));
        return;
      }
      const [, base64 = ''] = reader.result.split(',', 2);
      resolve({
        fileName: file.name,
        contentBase64: base64,
        contentType: file.type || undefined,
        sizeBytes: file.size,
        description: description || undefined,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function getAttachmentSignature(attachment: {
  fileName?: string;
  description?: string;
  sizeBytes?: number;
}): string {
  return [
    attachment.fileName ?? '',
    attachment.description ?? '',
    String(attachment.sizeBytes ?? ''),
  ].join('|');
}

function getAttachmentListSignature(
  attachments:
    | Array<{
        fileName?: string;
        description?: string;
        sizeBytes?: number;
      }>
    | null
    | undefined
): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return attachments.map((attachment) => getAttachmentSignature(attachment)).join('||');
}

function getNoteAttachments(
  note: { attachments?: NoteAttachment[]; attachment?: NoteAttachment } | null
): NoteAttachment[] {
  if (!note) {
    return [];
  }
  if (note.attachments && note.attachments.length > 0) {
    return note.attachments;
  }
  return note.attachment ? [note.attachment] : [];
}

function buildDraftSnapshot(input: {
  title: string;
  content: string;
  compactedContent: string | null;
  attachmentDescription: string;
  pendingAttachmentSignature: string | null;
  storedAttachmentSignature: string | null;
  removedAttachmentIds: string[];
  hiddenFromLlm: boolean;
  showOnDashboard: boolean;
  sharedSessionIds: string[];
}): string {
  return JSON.stringify({
    title: input.title,
    content: input.content,
    compactedContent: input.compactedContent,
    attachmentDescription: input.attachmentDescription,
    pendingAttachmentSignature: input.pendingAttachmentSignature,
    storedAttachmentSignature: input.storedAttachmentSignature,
    removedAttachmentIds: [...input.removedAttachmentIds].sort((a, b) => a.localeCompare(b)),
    hiddenFromLlm: input.hiddenFromLlm,
    showOnDashboard: input.showOnDashboard,
    sharedSessionIds: [...input.sharedSessionIds].sort((a, b) => a.localeCompare(b)),
  });
}

export function NoteEditorView({
  noteId,
  sessionId,
  agentId,
  onBack,
  onNoteCreated,
}: Readonly<NoteEditorViewProps>) {
  const {
    notes,
    createNote,
    updateNote,
    compactNote,
    crawlSummarizeWebsite,
    exportNoteMarkdown,
    deleteNote,
    compactingNote,
    crawlSummarizingWebsite,
    exportingNoteMarkdown,
    deletingNote,
  } = useSessionNotes(sessionId, agentId);
  const { client, agents } = useTeam();

  const isNew = noteId === 'new';
  const existingNote = isNew ? null : (notes.find((n) => n.id === noteId) ?? null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [attachmentDescription, setAttachmentDescription] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<NoteAttachmentInput[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [savedNoteId, setSavedNoteId] = useState<string | null>(isNew ? null : noteId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [hiddenFromLlm, setHiddenFromLlm] = useState(false);
  const [showOnDashboard, setShowOnDashboard] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [summarizeStatus, setSummarizeStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'content' | 'compacted' | 'text' | 'from-file' | 'from-web'
  >(isNew ? 'text' : 'content');
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [maxWords, setMaxWords] = useState(150);
  const [crawlMaxPages, setCrawlMaxPages] = useState(5);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [focusInstruction, setFocusInstruction] = useState('');
  const [generateTitleOnSummarize, setGenerateTitleOnSummarize] = useState(false);
  const [editedCompacted, setEditedCompacted] = useState<string | null>(null);

  // Track which note ID we've already initialised fields for so that a background
  // refetch (which briefly clears existingNote) doesn't wipe local edits.
  const initialisedForNoteId = useRef<string | null>(null);
  const lastAutosavedSnapshotRef = useRef<string | null>(null);

  // Thread + sharing state
  const [thread, setThread] = useState<SessionThread | null>(null);
  const [sharedSessionIds, setSharedSessionIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    client.sessions
      .getThread(sessionId)
      .then((t) => {
        if (!cancelled) setThread(t as SessionThread);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Populate fields when existing note loads — but only once per note ID so that
  // background refetches don't overwrite local edits (e.g. toggled sharing pills).
  useEffect(() => {
    if (existingNote) {
      if (initialisedForNoteId.current === existingNote.id) return; // already initialised
      initialisedForNoteId.current = existingNote.id;
      setTitle(existingNote.title ?? '');
      setContent(existingNote.content ?? '');
      setAttachmentDescription('');
      setPendingAttachments([]);
      setRemovedAttachmentIds([]);
      setSharedSessionIds(existingNote.sharedSessionIds ?? []);
      setHiddenFromLlm(existingNote.hiddenFromLlm ?? false);
      setShowOnDashboard(existingNote.showOnDashboard ?? false);
      lastAutosavedSnapshotRef.current = buildDraftSnapshot({
        title: existingNote.title ?? '',
        content: existingNote.content ?? '',
        compactedContent: existingNote.compactedContent ?? null,
        attachmentDescription: '',
        pendingAttachmentSignature: null,
        storedAttachmentSignature: getAttachmentListSignature(getNoteAttachments(existingNote)),
        removedAttachmentIds: [],
        hiddenFromLlm: existingNote.hiddenFromLlm ?? false,
        showOnDashboard: existingNote.showOnDashboard ?? false,
        sharedSessionIds: existingNote.sharedSessionIds ?? [],
      });
      setAutosaveState('idle');
    } else if (isNew) {
      if (initialisedForNoteId.current === 'new') return;
      initialisedForNoteId.current = 'new';
      setTitle('');
      setContent('');
      setAttachmentDescription('');
      setPendingAttachments([]);
      setRemovedAttachmentIds([]);
      setSharedSessionIds([]);
      setHiddenFromLlm(false);
      setShowOnDashboard(false);
      lastAutosavedSnapshotRef.current = buildDraftSnapshot({
        title: '',
        content: '',
        compactedContent: null,
        attachmentDescription: '',
        pendingAttachmentSignature: null,
        storedAttachmentSignature: null,
        removedAttachmentIds: [],
        hiddenFromLlm: false,
        showOnDashboard: false,
        sharedSessionIds: [],
      });
      setAutosaveState('idle');
    }
  }, [existingNote?.id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeNoteId = savedNoteId ?? (isNew ? null : noteId);
  const activeNote = activeNoteId ? (notes.find((n) => n.id === activeNoteId) ?? null) : null;
  const compactedContent = activeNote?.compactedContent ?? existingNote?.compactedContent ?? null;
  const currentAttachments = getNoteAttachments(activeNote ?? existingNote);
  const keptCurrentAttachments = currentAttachments.filter(
    (attachment) => !removedAttachmentIds.includes(attachment.id)
  );
  const currentDraftSnapshot = buildDraftSnapshot({
    title,
    content,
    compactedContent: editedCompacted,
    attachmentDescription,
    pendingAttachmentSignature: getAttachmentListSignature(pendingAttachments),
    storedAttachmentSignature: getAttachmentListSignature(keptCurrentAttachments),
    removedAttachmentIds,
    hiddenFromLlm,
    showOnDashboard,
    sharedSessionIds,
  });

  // Keep editedCompacted in sync with the persisted compactedContent when it
  // changes (e.g. after a fresh compact run), but don't overwrite while the user
  // is actively editing.
  useEffect(() => {
    setEditedCompacted(compactedContent);
  }, [compactedContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    try {
      const newAttachments = await Promise.all(
        files.map((file) => readFileAsAttachmentAsync(file, attachmentDescription))
      );
      setPendingAttachments((prev) => [...prev, ...newAttachments]);
    } catch {
      globalThis.alert('Failed to read the selected file. Please try again.');
    } finally {
      event.target.value = '';
    }
  };

  const handleFileDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) return;
    try {
      const newAttachments = await Promise.all(
        files.map((file) => readFileAsAttachmentAsync(file, attachmentDescription))
      );
      setPendingAttachments((prev) => [...prev, ...newAttachments]);
    } catch {
      globalThis.alert('Failed to read the dropped file. Please try again.');
    }
  };

  const saveDraftAsync = async (options?: { forceCreate?: boolean }): Promise<string | null> => {
    setSaveError(null);
    const effectiveAttachments = pendingAttachments.map((attachment) => ({
      ...attachment,
      description: attachmentDescription || attachment.description || undefined,
    }));
    const retainedAttachments = keptCurrentAttachments.map((attachment) => ({ id: attachment.id }));
    const attachmentUpdates = [...retainedAttachments, ...effectiveAttachments];
    const hasMeaningfulDraft = Boolean(
      title.trim() ||
      content.trim() ||
      keptCurrentAttachments.length > 0 ||
      effectiveAttachments.length > 0
    );

    if (!activeNoteId && !options?.forceCreate && !hasMeaningfulDraft) {
      setAutosaveState('idle');
      return null;
    }

    try {
      setAutosaveState('saving');
      let savedId = activeNoteId;
      let savedAttachmentSignature: string | null = null;

      if (activeNoteId) {
        const updated = await updateNote({
          sessionId,
          noteId: activeNoteId,
          title: title.trim() || undefined,
          content,
          compactedContent: editedCompacted,
          sharedSessionIds: sharedSessionIds.length > 0 ? sharedSessionIds : null,
          hiddenFromLlm,
          showOnDashboard,
          attachments: attachmentUpdates,
        });
        savedAttachmentSignature = getAttachmentListSignature(getNoteAttachments(updated));
      } else {
        const created = await createNote({
          sessionId,
          agentId,
          sharedSessionIds: sharedSessionIds.length > 0 ? sharedSessionIds : undefined,
          title: title.trim() || undefined,
          content,
          hiddenFromLlm,
          showOnDashboard,
          attachments: effectiveAttachments.length > 0 ? effectiveAttachments : undefined,
        });
        setSavedNoteId(created.id);
        onNoteCreated?.(created.id);
        savedId = created.id;
        savedAttachmentSignature = getAttachmentListSignature(getNoteAttachments(created));
      }
      setPendingAttachments([]);
      setRemovedAttachmentIds([]);
      lastAutosavedSnapshotRef.current = buildDraftSnapshot({
        title,
        content,
        compactedContent: editedCompacted,
        attachmentDescription,
        pendingAttachmentSignature: null,
        storedAttachmentSignature: savedAttachmentSignature,
        removedAttachmentIds: [],
        hiddenFromLlm,
        showOnDashboard,
        sharedSessionIds,
      });
      setAutosaveState('saved');
      return savedId;
    } catch (error) {
      console.error('Failed to save note:', error);
      setSaveError('Failed to save note. Please try again.');
      setAutosaveState('error');
      return null;
    }
  };

  const handleDelete = async () => {
    if (!activeNoteId) return;
    const label = title.trim() || keptCurrentAttachments[0]?.fileName || 'this note';
    if (!globalThis.confirm(`Delete "${label}"?`)) return;
    try {
      await deleteNote({ sessionId, noteId: activeNoteId });
      onBack();
    } catch {
      globalThis.alert('Failed to delete note. Please try again.');
    }
  };

  const ensureActiveNoteForSummarizeAsync = async (): Promise<string | null> => {
    if (activeNoteId) {
      return activeNoteId;
    }

    return saveDraftAsync({ forceCreate: true });
  };

  const requestFocusInstructionForSummarize = (): string | undefined => {
    const response = globalThis.prompt(
      'Optional: what should the summary focus on?',
      focusInstruction
    );

    if (response === null) {
      return undefined;
    }

    setFocusInstruction(response);
    const normalized = response.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const handleCompact = async () => {
    setCompactError(null);
    setExportInfo(null);
    setSummarizeStatus(null);
    const noteIdForSummarize = await ensureActiveNoteForSummarizeAsync();
    if (!noteIdForSummarize) return;
    const selectedFocusInstruction = requestFocusInstructionForSummarize();
    try {
      await compactNote({
        sessionId,
        noteId: noteIdForSummarize,
        maxWords,
        focusInstruction: selectedFocusInstruction,
        generateTitle: generateTitleOnSummarize,
        onStatus: (s) => setSummarizeStatus(s),
      });
      setActiveTab('compacted');
    } catch {
      setCompactError('Failed to compact note. Is the LLM connected?');
    } finally {
      setSummarizeStatus(null);
    }
  };

  const handleExportMarkdown = async () => {
    if (!activeNoteId) return;
    setSaveError(null);
    setCompactError(null);
    setExportInfo(null);
    try {
      const result = await exportNoteMarkdown({ sessionId, noteId: activeNoteId });
      const attachmentPaths =
        result.attachmentPaths ?? (result.attachmentPath ? [result.attachmentPath] : []);
      const attachmentSuffix =
        attachmentPaths.length > 0 ? `\nLinked files: ${attachmentPaths.join(', ')}` : '';
      setExportInfo(`Markdown exported to ${result.markdownPath}${attachmentSuffix}`);
    } catch {
      setSaveError('Failed to export markdown note. Please try again.');
    }
  };

  const handleCrawlSummarizeWebsite = async () => {
    const normalizedUrl = websiteUrl.trim();
    if (!normalizedUrl) {
      setCompactError('Provide a website URL before crawling.');
      return;
    }

    setSaveError(null);
    setCompactError(null);
    setExportInfo(null);

    setSummarizeStatus(null);
    const noteIdForSummarize = await ensureActiveNoteForSummarizeAsync();
    if (!noteIdForSummarize) return;
    const selectedFocusInstruction = requestFocusInstructionForSummarize();
    try {
      await crawlSummarizeWebsite({
        sessionId,
        noteId: noteIdForSummarize,
        websiteUrl: normalizedUrl,
        maxPages: crawlMaxPages,
        maxWords,
        focusInstruction: selectedFocusInstruction,
        generateTitle: generateTitleOnSummarize,
        onStatus: (s) => setSummarizeStatus(s),
      });
      setActiveTab('compacted');
      setExportInfo(`Website summary added to note from ${normalizedUrl}`);
    } catch {
      setCompactError('Failed to crawl and summarize website. Check URL and LLM connection.');
    } finally {
      setSummarizeStatus(null);
    }
  };

  const handleCopyCompacted = async () => {
    if (!editedCompacted) return;
    try {
      await navigator.clipboard.writeText(editedCompacted);
    } catch {
      setSaveError('Failed to copy compacted note. Please copy it manually.');
    }
  };

  const handleCopyContent = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      setSaveError('Failed to copy note content. Please copy it manually.');
    }
  };

  const handleHiddenToggle = async () => {
    const next = !hiddenFromLlm;
    setHiddenFromLlm(next);
    if (activeNoteId) {
      try {
        await updateNote({ sessionId, noteId: activeNoteId, hiddenFromLlm: next });
      } catch {
        setHiddenFromLlm(!next); // revert on failure
      }
    }
  };

  const handleSharedSessionToggle = async (targetSessionId: string) => {
    const previous = sharedSessionIds;
    const next = previous.includes(targetSessionId)
      ? previous.filter((id) => id !== targetSessionId)
      : [...previous, targetSessionId];

    setSharedSessionIds(next);
    if (!activeNoteId) {
      return;
    }

    try {
      await updateNote({
        sessionId,
        noteId: activeNoteId,
        sharedSessionIds: next.length > 0 ? next : null,
      });
    } catch {
      setSharedSessionIds(previous);
      setSaveError('Failed to update note sharing. Please try again.');
    }
  };

  const handleDashboardToggle = async () => {
    const next = !showOnDashboard;
    setShowOnDashboard(next);
    if (!activeNoteId) {
      return;
    }

    try {
      await updateNote({ sessionId, noteId: activeNoteId, showOnDashboard: next });
    } catch {
      setShowOnDashboard(!next);
      setSaveError('Failed to update dashboard visibility. Please try again.');
    }
  };

  useEffect(() => {
    setActiveTab(isNew ? 'text' : 'content');
  }, [existingNote?.id, isNew]);

  useEffect(() => {
    if (currentDraftSnapshot === lastAutosavedSnapshotRef.current) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      void saveDraftAsync();
    }, 700);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [currentDraftSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="graph-view-header">
        <button className="graph-view-back" onClick={onBack}>
          <i className="codicon codicon-arrow-left" /> Back to chat
        </button>
        <span className="graph-view-header-title">
          {isNew ? 'New note' : title.trim() || 'Edit note'}
        </span>
      </div>

      <div className="note-editor-view">
        <div className="note-editor-body">
          <input
            className="note-editor-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title (optional)"
          />

          <div className="note-editor-tabs" role="tablist" aria-label="Note editor tabs">
            {isNew ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'text'}
                  className={`note-editor-tab${activeTab === 'text' ? ' note-editor-tab--active' : ''}`}
                  onClick={() => setActiveTab('text')}
                >
                  <i className="codicon codicon-note" /> Text
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'from-file'}
                  className={`note-editor-tab${activeTab === 'from-file' ? ' note-editor-tab--active' : ''}`}
                  onClick={() => setActiveTab('from-file')}
                >
                  <i className="codicon codicon-paperclip" /> From file
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'from-web'}
                  className={`note-editor-tab${activeTab === 'from-web' ? ' note-editor-tab--active' : ''}`}
                  onClick={() => setActiveTab('from-web')}
                >
                  <i className="codicon codicon-globe" /> From web
                </button>
              </>
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'content'}
                className={`note-editor-tab${activeTab === 'content' ? ' note-editor-tab--active' : ''}`}
                onClick={() => setActiveTab('content')}
              >
                Content
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'compacted'}
              className={`note-editor-tab${activeTab === 'compacted' ? ' note-editor-tab--active' : ''}`}
              onClick={() => setActiveTab('compacted')}
              disabled={editedCompacted === null}
              title={
                editedCompacted === null
                  ? 'No compacted version yet — use Compact or Crawl + Summarize'
                  : 'Compacted version used by LLM'
              }
            >
              <i className="codicon codicon-symbol-misc" /> Compacted
              {editedCompacted !== null ? <span className="note-editor-tab-dot" /> : null}
            </button>
          </div>

          {activeTab === 'content' ||
          activeTab === 'text' ||
          activeTab === 'from-file' ||
          activeTab === 'from-web' ? (
            <>
              {!isNew || activeTab === 'text' ? (
                <>
                  <textarea
                    className="note-editor-content-input"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write Markdown here…"
                  />

                  {!isNew ? (
                    <div className="note-editor-content-editor-footer">
                      <button
                        type="button"
                        className="note-editor-compact-copy-btn"
                        onClick={() => void handleCopyContent()}
                        disabled={!content}
                        title="Copy note content"
                      >
                        <i className="codicon codicon-copy" /> Copy
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {!isNew || activeTab === 'from-file' ? (
                <>
                  <label
                    className="note-editor-dropzone"
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    <span className="note-editor-dropzone-row">
                      <span className="note-editor-choose-btn">Choose file</span>
                      <span className="note-editor-dropzone-copy">
                        or drag and drop a file here
                      </span>
                    </span>
                    <input
                      type="file"
                      multiple
                      onChange={handleFileChange}
                      aria-label="Choose attachment file"
                      title="Choose attachment file"
                    />
                    {keptCurrentAttachments.map((attachment) => (
                      <span key={attachment.id} className="note-editor-attachment-row">
                        <i className="codicon codicon-paperclip note-editor-attachment-icon" />
                        <span className="note-editor-attachment-name">{attachment.fileName}</span>
                        <button
                          type="button"
                          className="note-editor-remove-btn"
                          title="Remove attachment"
                          onClick={(e) => {
                            e.preventDefault();
                            setRemovedAttachmentIds((prev) => [...prev, attachment.id]);
                          }}
                        >
                          <i className="codicon codicon-close" />
                        </button>
                      </span>
                    ))}
                    {pendingAttachments.map((pendingAttachment, index) => (
                      <span
                        key={`${pendingAttachment.fileName}-${pendingAttachment.sizeBytes ?? 0}-${index}`}
                        className="note-editor-attachment-row"
                      >
                        <i className="codicon codicon-paperclip note-editor-attachment-icon" />
                        <span className="note-editor-attachment-name">
                          {pendingAttachment.fileName}
                        </span>
                        <button
                          type="button"
                          className="note-editor-remove-btn"
                          title="Clear attachment"
                          onClick={(e) => {
                            e.preventDefault();
                            setPendingAttachments((prev) =>
                              prev.filter((_, currentIndex) => currentIndex !== index)
                            );
                          }}
                        >
                          <i className="codicon codicon-close" />
                        </button>
                      </span>
                    ))}
                  </label>

                  <input
                    className="note-editor-title-input"
                    value={attachmentDescription}
                    onChange={(e) => setAttachmentDescription(e.target.value)}
                    placeholder="Optional file description / prompt"
                  />
                </>
              ) : null}

              {(isNew && activeTab === 'from-file') || (!isNew && activeTab === 'content') ? (
                <div className="note-editor-summarize-controls">
                  <span className="note-editor-sharing-label">
                    <i className="codicon codicon-symbol-misc" /> Extract from file
                  </span>
                  <div className="note-editor-summarize-controls-row">
                    <span className="note-editor-summarize-controls-row-label">
                      Compact note in
                    </span>
                    <input
                      type="number"
                      className="note-editor-max-words-input note-editor-max-words-input--typing-only"
                      value={maxWords}
                      min={50}
                      max={2000}
                      onChange={(e) =>
                        setMaxWords(Math.max(50, Math.min(2000, Number(e.target.value))))
                      }
                      aria-label="Compact note target words"
                      title="Target number of words for the compact note"
                    />
                    <span className="note-editor-summarize-controls-row-label note-editor-summarize-controls-row-label--suffix">
                      words
                    </span>
                    <button
                      type="button"
                      className="note-editor-compact-btn"
                      onClick={handleCompact}
                      disabled={compactingNote}
                      title={`Generate a compact summary of this note for the LLM (max ${maxWords} words)`}
                    >
                      <i
                        className={`codicon ${
                          compactingNote
                            ? 'codicon-loading codicon-modifier-spin'
                            : 'codicon-symbol-misc'
                        }`}
                      />
                      {compactingNote ? 'Compacting…' : 'Compact note'}
                    </button>
                    <label className="note-editor-inline-toggle" title="Generate a title from the summarized content">
                      <input
                        type="checkbox"
                        checked={generateTitleOnSummarize}
                        onChange={(e) => setGenerateTitleOnSummarize(e.target.checked)}
                      />
                      <span>Generate title</span>
                    </label>
                  </div>
                </div>
              ) : null}

              {isNew && activeTab === 'from-web' ? (
                <div className="note-editor-summarize-controls">
                  <span className="note-editor-sharing-label">
                    <i className="codicon codicon-globe" /> Summarize from web
                  </span>
                  <div className="note-editor-summarize-controls-row">
                    <span className="note-editor-summarize-controls-row-label">
                      Crawl + summarize
                    </span>
                    <input
                      type="url"
                      className="note-editor-focus-input"
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      aria-label="Website URL to crawl"
                      placeholder="https://example.com"
                      title="Website URL to crawl and summarize"
                    />
                    <span className="note-editor-summarize-controls-row-label note-editor-summarize-controls-row-label--suffix">
                      up to
                    </span>
                    <input
                      type="number"
                      className="note-editor-max-words-input note-editor-max-words-input--typing-only"
                      value={crawlMaxPages}
                      min={1}
                      max={20}
                      onChange={(e) =>
                        setCrawlMaxPages(Math.max(1, Math.min(20, Number(e.target.value))))
                      }
                      aria-label="Crawl up to this many pages"
                      title="Crawl up to this many same-site pages before summarizing"
                    />
                    <span className="note-editor-summarize-controls-row-label note-editor-summarize-controls-row-label--suffix">
                      pages
                    </span>
                    <button
                      type="button"
                      className="note-editor-compact-btn"
                      onClick={handleCrawlSummarizeWebsite}
                      disabled={crawlSummarizingWebsite}
                      title="Crawl website pages, summarize with optional focus guidance, and save into this note"
                    >
                      <i
                        className={`codicon ${
                          crawlSummarizingWebsite
                            ? 'codicon-loading codicon-modifier-spin'
                            : 'codicon-globe'
                        }`}
                      />
                      {crawlSummarizingWebsite ? 'Crawling…' : 'Crawl + Summarize'}
                    </button>
                    <label className="note-editor-inline-toggle" title="Generate a title from the summarized content">
                      <input
                        type="checkbox"
                        checked={generateTitleOnSummarize}
                        onChange={(e) => setGenerateTitleOnSummarize(e.target.checked)}
                      />
                      <span>Generate title</span>
                    </label>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="note-editor-compacted-tab">
              {editedCompacted !== null ? (
                <>
                  <textarea
                    className="note-editor-content-input note-editor-content-input--compacted"
                    value={editedCompacted}
                    onChange={(e) => setEditedCompacted(e.target.value)}
                    aria-label="Compacted note version"
                  />
                  <div className="note-editor-compact-preview-footer">
                    <button
                      type="button"
                      className="note-editor-compact-copy-btn"
                      onClick={() => void handleCopyCompacted()}
                      title="Copy compacted version"
                    >
                      <i className="codicon codicon-copy" /> Copy
                    </button>
                  </div>
                </>
              ) : (
                <span className="note-editor-compacted-empty">
                  No compacted version yet. Use <strong>Compact</strong> or{' '}
                  <strong>Crawl + Summarize</strong> to generate one.
                </span>
              )}
            </div>
          )}

          {autosaveState === 'saving' ? (
            <span className="note-editor-save-status">Saving changes…</span>
          ) : null}
          {autosaveState === 'saved' ? (
            <span className="note-editor-save-status">All changes saved</span>
          ) : null}

          {/* Sharing section — available only after note is saved */}
          {activeNoteId && thread ? (
            <div className="note-editor-sharing">
              <span className="note-editor-sharing-label">
                <i className="codicon codicon-organization" /> Visible to sessions
              </span>
              <div className="note-editor-sharing-sessions">
                {/* Owning session — always shown, toggles hiddenFromLlm */}
                {(() => {
                  const owningSession = thread.sessions.find(
                    (s: SessionNode) => s.sessionId === sessionId
                  );
                  const owningAgentId = owningSession?.agentIds[0];
                  const owningAgent = agents.find((a) => a.id === owningAgentId);
                  const isVisible = !hiddenFromLlm;
                  return (
                    <button
                      key={sessionId}
                      type="button"
                      className={`note-editor-share-session${isVisible ? ' note-editor-share-session--active' : ''}`}
                      style={
                        owningAgent
                          ? ({ '--agent-color': getAgentColor(owningAgent) } as CSSProperties)
                          : undefined
                      }
                      title={
                        isVisible
                          ? "Hide from this agent's LLM context"
                          : "Show in this agent's LLM context"
                      }
                      onClick={handleHiddenToggle}
                    >
                      <Avatar agent={owningAgent} size="small" />
                      <span className="note-editor-share-session-name">
                        {owningSession?.agentNames[0] ?? 'This session'}
                        <span className="note-editor-share-session-owner"> (owner)</span>
                      </span>
                      {isVisible ? (
                        <i className="codicon codicon-check" />
                      ) : (
                        <i className="codicon codicon-eye-closed" />
                      )}
                    </button>
                  );
                })()}
                {/* Other thread sessions */}
                {thread.sessions
                  .filter((s: SessionNode) => s.sessionId !== sessionId)
                  .map((s: SessionNode) => {
                    const firstAgentId = s.agentIds[0];
                    const agent = agents.find((a) => a.id === firstAgentId);
                    const isShared = sharedSessionIds.includes(s.sessionId);

                    return (
                      <button
                        key={s.sessionId}
                        type="button"
                        className={`note-editor-share-session${isShared ? ' note-editor-share-session--active' : ''}`}
                        style={
                          agent
                            ? ({ '--agent-color': getAgentColor(agent) } as CSSProperties)
                            : undefined
                        }
                        title={`${isShared ? 'Remove from' : 'Share with'} ${s.agentNames[0] ?? s.sessionId}`}
                        onClick={() => void handleSharedSessionToggle(s.sessionId)}
                      >
                        <Avatar agent={agent} size="small" />
                        <span className="note-editor-share-session-name">
                          {s.agentNames[0] ?? s.sessionId}
                        </span>
                        {isShared ? <i className="codicon codicon-check" /> : null}
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : null}

          {activeNoteId ? (
            <div className="note-editor-sharing">
              <span className="note-editor-sharing-label">
                <i className="codicon codicon-home" /> Developer visibility
              </span>
              <div className="note-editor-sharing-sessions">
                <button
                  type="button"
                  className={`note-editor-share-session${showOnDashboard ? ' note-editor-share-session--active' : ''}`}
                  title={
                    showOnDashboard
                      ? 'Remove this note from the start page'
                      : 'Show this note on the start page for the developer'
                  }
                  onClick={() => void handleDashboardToggle()}
                >
                  <i className="codicon codicon-home" />
                  <span className="note-editor-share-session-name">Show on start page</span>
                  {showOnDashboard ? <i className="codicon codicon-check" /> : null}
                </button>
              </div>
            </div>
          ) : null}

          {saveError ? <span className="note-editor-error">{saveError}</span> : null}
          {compactError ? <span className="note-editor-error">{compactError}</span> : null}
          {exportInfo ? <span className="note-editor-export-info">{exportInfo}</span> : null}
          {summarizeStatus ? (
            <span className="note-editor-summarize-status">⏳ {summarizeStatus}</span>
          ) : null}

          <div className="note-editor-actions">
            {activeNoteId ? (
              <>
                <button
                  type="button"
                  className="note-editor-compact-btn"
                  onClick={handleExportMarkdown}
                  disabled={exportingNoteMarkdown}
                  title="Export this note to markdown and move linked files out of ignored storage"
                >
                  <i
                    className={`codicon ${
                      exportingNoteMarkdown
                        ? 'codicon-loading codicon-modifier-spin'
                        : 'codicon-export'
                    }`}
                  />
                  {exportingNoteMarkdown ? 'Exporting…' : 'Export .md'}
                </button>
              </>
            ) : null}
            {activeNoteId ? (
              <button
                type="button"
                className="note-editor-delete-btn"
                title="Delete note"
                onClick={handleDelete}
                disabled={deletingNote}
              >
                <i
                  className={`codicon ${deletingNote ? 'codicon-loading codicon-modifier-spin' : 'codicon-trash'}`}
                />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
