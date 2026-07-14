import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { useTeam } from '../../context/TeamContext';
import { contextPanelQueryKeys } from '../../hooks/contextPanelQueryKeys';
import type { ChatMessage, SessionActivatedTool, SessionThread } from '../../types';
import type {
  AgentToolPermissionEntry,
  IdeEditSession,
  ChatCommandRegistryEntry,
  Note,
  NoteSessionShare,
} from '@ai-team/api-contracts';
import { useSlashCommandSuggestions } from '../../hooks/useSlashCommandSuggestions';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';
import { pickVoice, stripMarkdownForSpeech } from '../../utils/agentVoice';
import {
  backfillActivatedToolRequests,
  extractSessionActivatedTools,
  reconstructActivatedToolsFromMessages,
  findMatchingMessage,
  GRAPH_ROUTE,
  NOTE_ROUTE,
  normalizeChatErrorMessage,
  resolveRouteAgent,
  resolveRuntimeToolEventMessage,
  shouldRenderSlashToolMessage,
  SESSION_ROUTE,
} from './chatPanelUtils';
import type {
  ChecklistQuestionRequest,
  ConfirmQuestionRequest,
  InputQuestionRequest,
  PasswordQuestionRequest,
  PendingQuestion,
  SelectQuestionRequest,
} from './chatPanelTypes';

interface CodeEditProposalFile {
  filePath: string;
  oldContent?: string;
  newContent?: string;
}

interface CodeEditProposalEvent {
  kind: 'code_edit_proposal';
  proposalId?: string;
  agentName?: string;
  description?: string;
  files?: CodeEditProposalFile[];
}

interface CancelToken {
  value: boolean;
}

interface ThreadNoteLookupEntry {
  title: string;
  sizeLabel: string;
  sessionId: string;
  agentId: string;
}

const GREETING_DEDUPE_WINDOW_MS = 2000;

export async function awaitUnlessCancelled<T>(
  promise: Promise<T>,
  cancelToken?: CancelToken
): Promise<T | undefined> {
  const result = await promise;
  if (cancelToken?.value) {
    return undefined;
  }
  return result;
}

export function shouldSkipDuplicateGreetingSpeech(
  nextFingerprint: string,
  previousFingerprint: string | null,
  previousTimestamp: number,
  now: number,
  dedupeWindowMs = GREETING_DEDUPE_WINDOW_MS
): boolean {
  if (!previousFingerprint || previousFingerprint !== nextFingerprint) {
    return false;
  }

  return now - previousTimestamp <= dedupeWindowMs;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNoteSizeLabel(note: Note): string {
  const contentBytes = new Blob([note.content ?? '']).size;
  const legacyAttachmentBytes = note.attachment?.sizeBytes ?? 0;
  const attachmentsBytes = (note.attachments ?? []).reduce(
    (sum, attachment) => sum + attachment.sizeBytes,
    0
  );
  const totalBytes = contentBytes + attachmentsBytes + legacyAttachmentBytes;
  const totalKb = totalBytes / 1024;
  const normalizedKb = totalKb >= 10 ? totalKb.toFixed(0) : totalKb.toFixed(1);
  return `${normalizedKb} KB`;
}

interface UseChatPanelControllerResult {
  routeAgentId?: string;
  currentAgentId: string;
  currentSessionId: string | null;
  currentSessionTitle: string | null;
  graphSessionId: string | null;
  noteRouteId: string | null;
  loading: boolean;
  sending: boolean;
  streaming: boolean;
  compressionInProgress: boolean;
  chatError: string | null;
  messages: ChatMessage[];
  input: string;
  editingIndex: number | null;
  editContent: string;
  artifactsInContext: string[];
  toolEntries: AgentToolPermissionEntry[];
  activatedTools: SessionActivatedTool[];
  pendingQuestion: PendingQuestion | null;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
  isRecording: boolean;
  interimTranscript: string;
  recognition: any;
  ttsEnabled: boolean;
  ttsSupported: boolean;
  ttsSpeaking: boolean;
  ttsPaused: boolean;
  ttsSpeakingWord: string | null;
  ttsSpeakingOccurrence: number | null;
  ttsRate: number;
  setTtsRate: (rate: number) => void;
  toggleTts: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  developer: ReturnType<typeof useTeam>['developer'];
  agents: ReturnType<typeof useTeam>['agents'];
  agent: ReturnType<typeof useTeam>['agents'][number] | undefined;
  handleNavigatePortfolio: () => void;
  handleGraphBack: () => void;
  handleSelectSessionFromGraph: (
    targetSessionId: string,
    targetAgentId: string,
    handoffId?: string
  ) => void;
  handleScroll: () => void;
  handleSummarize: (
    toIndex: number,
    options?: { compactPercent?: number; focusInstruction?: string }
  ) => Promise<void>;
  handleLinkNote: (messageIndex: number, noteId: string) => Promise<void>;
  handleUnlinkNote: (messageIndex: number, noteId: string) => Promise<void>;
  noteSharesByMessageIndex: Record<number, Array<{ noteId: string; label: string }>>;
  handleSplitSession: (atIndex: number) => Promise<void>;
  setEditContent: (value: string) => void;
  handleEditMessage: (index: number) => Promise<void>;
  handleCancelEdit: () => void;
  handleCopyMessage: (content: string) => void;
  handleSpeakMessage: (
    content: string,
    fromAgentId: string,
    options?: { selected?: boolean }
  ) => void;
  handleStopSpeaking: (context?: 'message' | 'input') => void;
  handlePauseSpeaking: () => void;
  handleResumeSpeaking: () => void;
  handleToggleArchive: (index: number, currentlyArchived: boolean) => Promise<void>;
  handleToggleToolResultHidden: (
    messageIndex: number,
    hidden: boolean,
    toolCallId?: number
  ) => Promise<void>;
  handleSummarizeToolResult: (
    messageIndex: number,
    options?: { toolCallId?: number; focusInstruction?: string; maxWords?: number }
  ) => Promise<void>;
  handleDeleteMessage: (index: number) => Promise<void>;
  handleHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => Promise<void>;
  handleOpenFileReference: (filePath: string) => Promise<void>;
  handleOpenAgentReference: (agentId: string) => void;
  handleSuggestedToolHandoff: (targetAgentId: string, task?: string) => Promise<void>;
  setPendingInputAnswer: (value: string) => void;
  setPendingPasswordAnswer: (value: string) => void;
  setPendingConfirmAnswer: (value: boolean) => void;
  setPendingSelectAnswer: (value: string) => void;
  togglePendingChecklistValue: (choiceValue: string, checked: boolean) => void;
  setPendingFormFieldValue: (fieldId: string, value: string) => void;
  handlePendingQuestionSubmit: (event: { preventDefault(): void }) => void;
  handleConfirmDirectAnswer: (value: boolean) => void;
  handleInputChange: (value: string) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  startVoiceRecording: () => void;
  stopVoiceRecording: () => void;
  handleSend: () => Promise<void>;
  handleInterrupt: () => void;
  dismissChatError: () => void;
  handleToggleArtifact: (artifactId: string) => Promise<void>;
  handleSwitchSession: (sessionId: string) => Promise<void>;
  handleDeleteSession: (deletedSessionId: string) => void;
  handleCreateSession: () => Promise<void>;
  handleSaveSessionTitle: (title: string) => Promise<void>;
  handleOpenSessionGraph: (sessionId: string) => void;
  handleOpenNote: (noteId: string, options?: { sessionId?: string; agentId?: string }) => void;
  handleNoteBack: () => void;
  selectedMessageGroupKeys: string[];
  handleToggleMessageGroupSelection: (selection: {
    key: string;
    label: string;
    markdown: string;
  }) => void;
  handleClearMessageGroupSelection: () => void;
  handleSaveInputAsNote: () => Promise<void>;
  /** Slash-command autocomplete state */
  slashSuggestions: ChatCommandRegistryEntry[];
  slashSelectedIndex: number;
  slashIsOpen: boolean;
  handleSlashSelect: (index: number) => void;
}

export function useChatPanelController(): UseChatPanelControllerResult {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents, client, developer, loading: teamLoading } = useTeam();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [compressionInProgress, setCompressionInProgress] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentAgentId, setCurrentAgentId] = useState(agentId || '');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const noteSharesQuery = useQuery<NoteSessionShare[]>({
    queryKey: ['noteShares', currentSessionId],
    queryFn: () => client.sessions.listNoteShares(currentSessionId!) as Promise<NoteSessionShare[]>,
    enabled: Boolean(currentSessionId),
  });
  const threadNoteLookupQuery = useQuery<Record<string, ThreadNoteLookupEntry>>({
    queryKey: ['threadNoteLookup', currentSessionId],
    queryFn: async () => {
      const lookup: Record<string, ThreadNoteLookupEntry> = {};
      const thread = (await client.sessions.getThread(currentSessionId!)) as SessionThread;
      const notesBySession = await Promise.all(
        thread.sessions.map(async (session) => {
          const notes = await client.sessions.listNotes(session.sessionId);
          return [session.sessionId, session.agentIds[0] ?? currentAgentId, notes] as const;
        })
      );

      for (const [sessionId, fallbackAgentId, notes] of notesBySession) {
        for (const note of notes) {
          const title = note.title?.trim() || note.attachment?.fileName || note.id;
          const ownerSessionId = note.sessionId ?? sessionId;
          lookup[note.id] = {
            title,
            sizeLabel: formatNoteSizeLabel(note),
            sessionId: ownerSessionId,
            agentId: note.agentId || fallbackAgentId,
          };
        }
      }

      return lookup;
    },
    enabled: Boolean(currentSessionId),
  });
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [artifactsInContext, setArtifactsInContext] = useState<string[]>([]);
  const [toolEntries, setToolEntries] = useState<AgentToolPermissionEntry[]>([]);
  const [activatedTools, setActivatedTools] = useState<SessionActivatedTool[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [recognition, setRecognition] = useState<any>(null);
  const isRecordingRef = useRef(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('ai-team.ttsEnabled');
      // Default to true if never set
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });
  const tts = useSpeechSynthesis();
  const ttsSentenceBuffer = useRef('');
  const [ttsRate, setTtsRateState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('ai-team.ttsRate');
      return stored ? parseFloat(stored) : 1.0;
    } catch {
      return 1.0;
    }
  });
  const ttsRateRef = useRef(ttsRate);
  ttsRateRef.current = ttsRate;
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingInputAnswer, setPendingInputAnswer] = useState('');
  const [pendingPasswordAnswer, setPendingPasswordAnswer] = useState('');
  const [pendingConfirmAnswer, setPendingConfirmAnswer] = useState(false);
  const [pendingSelectAnswer, setPendingSelectAnswer] = useState('');
  const [pendingChecklistAnswer, setPendingChecklistAnswer] = useState<string[]>([]);
  const [pendingFormAnswer, setPendingFormAnswer] = useState<Record<string, string>>({});
  const [selectedMessageGroups, setSelectedMessageGroups] = useState<
    Array<{ key: string; label: string; markdown: string }>
  >([]);
  const [scrollToHandoffId, setScrollToHandoffId] = useState<string | null>(null);
  const [_isEphemeral, setIsEphemeral] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const lastScrollTopRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingQuestionResolveRef = useRef<((value: unknown) => void) | null>(null);
  const pendingQuestionRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  const assistantIndexRef = useRef(-1);
  const skipNextSessionLoadRef = useRef<string | null>(null);
  const skipNewSessionRef = useRef(false);
  const lastPersistedToolStateRef = useRef('');
  const greetingCancelRef = useRef<{ value: boolean }>({ value: false });
  const latestGreetingLoadIdRef = useRef(0);
  const lastGreetingSpeechRef = useRef<{ fingerprint: string; at: number } | null>(null);

  const graphRouteMatch = useMatch(GRAPH_ROUTE);
  const noteRouteMatch = useMatch(NOTE_ROUTE);
  const sessionRouteMatch = useMatch(SESSION_ROUTE);
  const urlSessionId =
    graphRouteMatch?.params?.sessionId ??
    noteRouteMatch?.params?.sessionId ??
    sessionRouteMatch?.params?.sessionId ??
    null;
  const graphSessionId = graphRouteMatch?.params?.sessionId ?? null;
  /** `'new'` when creating, a note ID string when editing, `null` when not in note view */
  const noteRouteId = noteRouteMatch?.params?.noteId ?? null;

  const agent = agents.find((entry) => entry.id === currentAgentId);

  const autoResizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '1px';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(autoResizeTextarea);
    return () => cancelAnimationFrame(frame);
  }, [autoResizeTextarea, input]);

  const speakGreetingIfNeeded = (greetingMessage: ChatMessage) => {
    if (!ttsEnabled || !tts.supported || !greetingMessage.content) {
      return;
    }

    const runtimeVoices =
      typeof globalThis.window !== 'undefined' && 'speechSynthesis' in globalThis.window
        ? globalThis.window.speechSynthesis.getVoices()
        : [];
    const availableVoices = runtimeVoices.length > 0 ? runtimeVoices : tts.voices;
    const greetingAgent = agents.find((a) => a.id === greetingMessage.from);
    const voice = pickVoice(greetingAgent, availableVoices);
    const rate = greetingAgent?.ttsRate ?? ttsRateRef.current;
    const clean = stripMarkdownForSpeech(greetingMessage.content);
    if (!clean) {
      return;
    }

    const fingerprint = `${greetingMessage.from}::${clean}`;
    const now = Date.now();
    const previous = lastGreetingSpeechRef.current;
    const shouldSkip = shouldSkipDuplicateGreetingSpeech(
      fingerprint,
      previous?.fingerprint ?? null,
      previous?.at ?? 0,
      now
    );
    if (shouldSkip) {
      return;
    }

    lastGreetingSpeechRef.current = { fingerprint, at: now };
    tts.speakChunk(clean, voice, rate);
  };

  const loadGreeting = async (targetAgentId: string, cancelToken?: CancelToken) => {
    const greetingLoadId = ++latestGreetingLoadIdRef.current;
    try {
      if (cancelToken?.value) {
        return;
      }
      const data = await awaitUnlessCancelled(
        client.agents.introduction(targetAgentId, {
          developerName: developer?.name || 'Developer',
        }),
        cancelToken
      );
      if (!data) {
        return;
      }
      if (cancelToken?.value || greetingLoadId !== latestGreetingLoadIdRef.current) {
        return;
      }
      const greetingMessage: ChatMessage = {
        from: data.agentId ?? targetAgentId,
        content: data.content ?? '',
        timestamp: data.timestamp ?? new Date().toISOString(),
      };
      setMessages([greetingMessage]);
      setIsEphemeral(true);
      speakGreetingIfNeeded(greetingMessage);
    } catch {
      setMessages([]);
      setIsEphemeral(false);
    }
  };

  const resetSessionState = (targetAgentId: string) => {
    setCurrentSessionId(null);
    setCurrentSessionTitle(null);
    setArtifactsInContext([]);
    setActivatedTools([]);
    setCurrentAgentId(targetAgentId);
  };

  const applyLoadedSession = (targetAgentId: string, sessionWithMessages: any) => {
    setCurrentSessionId(sessionWithMessages.id);
    setCurrentSessionTitle(
      typeof sessionWithMessages.title === 'string' && sessionWithMessages.title.trim().length > 0
        ? sessionWithMessages.title.trim()
        : null
    );
    setMessages(sessionWithMessages.messages || []);
    setArtifactsInContext(sessionWithMessages.artifacts || []);
    setActivatedTools(
      backfillActivatedToolRequests(
        // activatedTools is already hydrated by the backend from session meta;
        // fall back to notes parsing, then reconstruct from messages for old sessions.
        (sessionWithMessages.activatedTools as SessionActivatedTool[] | undefined)?.length
          ? (sessionWithMessages.activatedTools as SessionActivatedTool[])
          : extractSessionActivatedTools(sessionWithMessages.notes).length
            ? extractSessionActivatedTools(sessionWithMessages.notes)
            : reconstructActivatedToolsFromMessages(sessionWithMessages.messages || []),
        sessionWithMessages.messages || []
      )
    );
    setCurrentAgentId(targetAgentId);
    setIsEphemeral(false);
  };

  const loadGreetingFallback = async (targetAgentId: string, cancelToken: CancelToken) => {
    resetSessionState(targetAgentId);
    if (!cancelToken.value) {
      await loadGreeting(targetAgentId, cancelToken);
    }
  };

  const loadPersistedSession = async (
    targetAgentId: string,
    targetSessionId: string | null,
    cancelToken: CancelToken
  ) => {
    try {
      let sessionWithMessages = targetSessionId
        ? await fetchSessionWithMessages(targetSessionId)
        : await fetchSessionWithMessagesFromAgent(targetAgentId);

      if (!sessionWithMessages) {
        throw new Error('Session not found');
      }

      const hasMessagesArray = Array.isArray(sessionWithMessages.messages);
      const messageCount = Number(sessionWithMessages.messageCount ?? 0);

      if (
        !targetSessionId &&
        (!hasMessagesArray || sessionWithMessages.messages.length === 0) &&
        messageCount > 0 &&
        typeof sessionWithMessages.id === 'string'
      ) {
        const fullSession = await fetchSessionWithMessages(sessionWithMessages.id);
        if (fullSession) {
          sessionWithMessages = fullSession;
        }
      }

      // When no specific session was requested and the latest session has no messages,
      // treat it as a fresh start — show the greeting (mirrors CLI behaviour).
      if (!targetSessionId && (sessionWithMessages.messages ?? []).length === 0) {
        if (!cancelToken.value) {
          await loadGreetingFallback(targetAgentId, cancelToken);
        }
        return;
      }
      if (!cancelToken.value) {
        applyLoadedSession(targetAgentId, sessionWithMessages);

        if (!targetSessionId && sessionWithMessages.id) {
          navigate(`/chat/${targetAgentId}/session/${sessionWithMessages.id}`, { replace: true });
        }
      }
      return;
    } catch {
      if (!cancelToken.value) {
        await loadGreetingFallback(targetAgentId, cancelToken);
      }
    }
  };

  const getSessionPrimaryAgentId = (sessionWithMessages: any, fallbackAgentId: string) => {
    const sessionAgentId = Array.isArray(sessionWithMessages?.agentIds)
      ? sessionWithMessages.agentIds[0]
      : sessionWithMessages?.agentId;
    return typeof sessionAgentId === 'string' && sessionAgentId.length > 0
      ? sessionAgentId
      : fallbackAgentId;
  };

  const fetchSessionWithMessages = async (sessionId: string) => {
    try {
      const session = await client.sessions.getById(sessionId);
      const messages = await client.sessions.getMessages(sessionId);
      return {
        ...session,
        messages: Array.isArray(messages) ? messages : [],
      };
    } catch {
      return null;
    }
  };

  const fetchSessionWithMessagesFromAgent = async (agentId: string) => {
    try {
      const session = await client.sessions.latestByAgent(agentId);
      const messages = await client.sessions.getMessages(session.id);
      return {
        ...session,
        messages: Array.isArray(messages) ? messages : [],
      };
    } catch {
      return null;
    }
  };

  const syncSessionState = async (sessionId: string, fallbackAgentId: string) => {
    const sessionWithMessages = await fetchSessionWithMessages(sessionId);
    if (!sessionWithMessages) {
      return null;
    }

    applyLoadedSession(
      getSessionPrimaryAgentId(sessionWithMessages, fallbackAgentId),
      sessionWithMessages
    );
    return sessionWithMessages;
  };

  useEffect(() => {
    if (!currentAgentId) {
      setToolEntries([]);
      return;
    }

    let cancelled = false;
    const loadToolEntries = async () => {
      try {
        const response = (await client.tools.list({ agent: currentAgentId })) as {
          entries: AgentToolPermissionEntry[];
        };
        if (cancelled) {
          return;
        }
        setToolEntries(response.entries ?? []);
      } catch {
        if (!cancelled) {
          setToolEntries([]);
        }
      }
    };

    void loadToolEntries();
    return () => {
      cancelled = true;
    };
  }, [client, currentAgentId]);

  useEffect(() => {
    if (!scrollToHandoffId) {
      return;
    }
    const timer = setTimeout(() => {
      const element = messagesContainerRef.current?.querySelector<HTMLElement>(
        `[data-handoff-id="${scrollToHandoffId}"]`
      );
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add('handoff-highlight');
        setTimeout(() => element.classList.remove('handoff-highlight'), 1800);
        setScrollToHandoffId(null);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [messages, scrollToHandoffId]);

  useEffect(() => {
    if (!agentId || teamLoading) {
      return;
    }

    const cancelToken: CancelToken = { value: false };
    const loadSession = async () => {
      const resolvedRouteAgent = resolveRouteAgent(agents, agentId);
      const targetAgentId = resolvedRouteAgent?.id ?? agentId;

      setCurrentAgentId(targetAgentId);

      if (resolvedRouteAgent && agentId !== targetAgentId) {
        const canonicalPath = graphSessionId
          ? `/chat/${targetAgentId}/session/${graphSessionId}/thread`
          : urlSessionId
            ? `/chat/${targetAgentId}/session/${urlSessionId}`
            : `/chat/${targetAgentId}`;
        navigate(canonicalPath, { replace: true });
        setLoading(false);
        return;
      }

      if (urlSessionId && urlSessionId === skipNextSessionLoadRef.current) {
        skipNextSessionLoadRef.current = null;
        setLoading(false);
        return;
      }

      if (skipNewSessionRef.current) {
        skipNewSessionRef.current = false;
        setLoading(false);
        return;
      }

      greetingCancelRef.current.value = true;
      greetingCancelRef.current = cancelToken;
      setLoading(true);
      try {
        await loadPersistedSession(targetAgentId, urlSessionId, cancelToken);
      } catch (error) {
        console.error('Failed to load session:', error);
        if (!cancelToken.value) {
          resetSessionState(targetAgentId);
          await loadGreeting(targetAgentId, cancelToken);
        }
      } finally {
        if (!cancelToken.value) {
          setLoading(false);
        }
      }
    };

    void loadSession();
    return () => {
      cancelToken.value = true;
    };
  }, [agentId, agents, graphSessionId, navigate, teamLoading, urlSessionId]);

  const isAtBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return true;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 5;
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    const currentScrollTop = container.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;

    if (currentScrollTop < previousScrollTop) {
      setIsUserScrolledUp(true);
    } else if (isAtBottom()) {
      setIsUserScrolledUp(false);
    }

    lastScrollTopRef.current = currentScrollTop;
  };

  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isUserScrolledUp, messages]);

  const clearPendingQuestion = () => {
    pendingQuestionResolveRef.current = null;
    pendingQuestionRejectRef.current = null;
    setPendingQuestion(null);
    setPendingInputAnswer('');
    setPendingPasswordAnswer('');
    setPendingConfirmAnswer(false);
    setPendingSelectAnswer('');
    setPendingChecklistAnswer([]);
    setPendingFormAnswer({});
  };

  const rejectAndClearPendingQuestion = (reason: Error) => {
    pendingQuestionRejectRef.current?.(reason);
    clearPendingQuestion();
  };

  const beginPendingQuestion = <T>(question: PendingQuestion): Promise<T> => {
    pendingQuestionRejectRef.current?.(
      new Error('Previous question was replaced before submission.')
    );

    if (question.kind === 'input') {
      setPendingInputAnswer('');
    } else if (question.kind === 'password') {
      setPendingPasswordAnswer('');
    } else if (question.kind === 'confirm') {
      setPendingConfirmAnswer(question.defaultValue);
    } else if (question.kind === 'select') {
      setPendingSelectAnswer(question.choices[0]?.value ?? '');
    } else if (question.kind === 'checklist') {
      setPendingChecklistAnswer([]);
    } else if (question.kind === 'form') {
      const initialValues = question.fields.reduce<Record<string, string>>((accumulator, field) => {
        accumulator[field.id] = field.default ?? '';
        return accumulator;
      }, {});
      setPendingFormAnswer(initialValues);
    }

    setPendingQuestion(question);

    return new Promise<T>((resolve, reject) => {
      pendingQuestionResolveRef.current = (value: unknown) => resolve(value as T);
      pendingQuestionRejectRef.current = reject;
    });
  };

  const askInputQuestion = async (request: InputQuestionRequest): Promise<string> =>
    beginPendingQuestion<string>({ kind: 'input', message: request.message });
  const askConfirmQuestion = async (request: ConfirmQuestionRequest): Promise<boolean> =>
    beginPendingQuestion<boolean>({
      kind: 'confirm',
      message: request.message,
      defaultValue: request.default ?? false,
      style: request.style,
    });

  const handleConfirmDirectAnswer = (value: boolean) => {
    if (!pendingQuestionResolveRef.current || pendingQuestion?.kind !== 'confirm') return;
    pendingQuestionResolveRef.current(value);
    clearPendingQuestion();
  };
  const askSelectQuestion = async (request: SelectQuestionRequest): Promise<string> =>
    beginPendingQuestion<string>({
      kind: 'select',
      message: request.message,
      choices: request.choices,
      allowOther: request.allowOther,
      otherLabel: request.otherLabel,
      otherPrompt: request.otherPrompt,
    });
  const askPasswordQuestion = async (request: PasswordQuestionRequest): Promise<string> =>
    beginPendingQuestion<string>({ kind: 'password', message: request.message });
  const askChecklistQuestion = async (request: ChecklistQuestionRequest): Promise<string[]> =>
    beginPendingQuestion<string[]>({
      kind: 'checklist',
      message: request.message,
      choices: request.choices,
      allowOther: request.allowOther,
      otherLabel: request.otherLabel,
      otherPrompt: request.otherPrompt,
    });
  const togglePendingChecklistValue = (choiceValue: string, checked: boolean) => {
    setPendingChecklistAnswer((previous) =>
      checked ? [...previous, choiceValue] : previous.filter((value) => value !== choiceValue)
    );
  };

  const setPendingFormFieldValue = (fieldId: string, value: string) => {
    setPendingFormAnswer((previous) => ({
      ...previous,
      [fieldId]: value,
    }));
  };

  const handlePendingQuestionSubmit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!pendingQuestionResolveRef.current || !pendingQuestion) {
      return;
    }

    if (pendingQuestion.kind === 'input') {
      pendingQuestionResolveRef.current(pendingInputAnswer);
    } else if (pendingQuestion.kind === 'password') {
      pendingQuestionResolveRef.current(pendingPasswordAnswer);
    } else if (pendingQuestion.kind === 'confirm') {
      pendingQuestionResolveRef.current(pendingConfirmAnswer);
    } else if (pendingQuestion.kind === 'select') {
      pendingQuestionResolveRef.current(pendingSelectAnswer);
    } else if (pendingQuestion.kind === 'checklist') {
      pendingQuestionResolveRef.current(pendingChecklistAnswer);
    } else if (pendingQuestion.kind === 'form') {
      pendingQuestionResolveRef.current(pendingFormAnswer);
    }

    clearPendingQuestion();
  };

  const handleInterrupt = () => {
    rejectAndClearPendingQuestion(new Error('Question interrupted by user.'));
    handleStopSpeaking('input');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSending(false);
    setStreaming(false);
  };

  useEffect(() => {
    return () => {
      rejectAndClearPendingQuestion(new Error('Question interrupted: chat panel unmounted.'));
    };
  }, []);

  const updateAssistantMessageContent = (content: string) => {
    setMessages((previous) => {
      const updated = [...previous];
      const index = assistantIndexRef.current;
      if (index >= 0 && index < updated.length) {
        updated[index] = {
          ...updated[index],
          content,
        };
      }
      return updated;
    });
  };

  const ensureSessionForSend = async () => {
    if (currentSessionId) {
      return currentSessionId;
    }

    const newSession = await client.sessions.create({
      agentId: currentAgentId,
      developerId: developer?.id || 'clemens-meier',
    });
    const sessionId = newSession.id as string;
    setCurrentSessionId(sessionId);
    setCurrentSessionTitle(
      typeof newSession.title === 'string' && newSession.title.trim().length > 0
        ? newSession.title.trim()
        : null
    );
    setIsEphemeral(false);
    await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
    skipNextSessionLoadRef.current = sessionId;
    navigate(`/chat/${currentAgentId}/session/${sessionId}`, { replace: true });
    return sessionId;
  };

  const handleStreamHandoff = async (event: any, activeSessionId: string | null) => {
    const toAgentId = event.toAgentId as string | undefined;
    const toSessionId = event.toSessionId as string | undefined;
    if (!toAgentId) {
      return false;
    }

    try {
      let targetSessionId = toSessionId ?? null;
      if (!targetSessionId) {
        if (!activeSessionId) {
          return false;
        }
        const newSession = await client.sessions.handoff({
          toAgentId,
          developerId: developer?.id || 'clemens-meier',
          previousSessionId: activeSessionId,
          transferArtifacts: true,
          transferAllowedFiles: true,
        });
        targetSessionId = newSession.id;
      }

      if (!targetSessionId) {
        return false;
      }

      const sessionWithMessages = await fetchSessionWithMessages(targetSessionId);
      if (!sessionWithMessages) {
        return true;
      }

      const existingMessages: ChatMessage[] = sessionWithMessages.messages || [];
      assistantIndexRef.current = existingMessages.length;
      setMessages([
        ...existingMessages,
        {
          from: toAgentId,
          content: '',
          timestamp: new Date().toISOString(),
        },
      ]);
      setCurrentSessionId(targetSessionId);
      setCurrentSessionTitle(
        typeof sessionWithMessages.title === 'string' && sessionWithMessages.title.trim().length > 0
          ? sessionWithMessages.title.trim()
          : null
      );
      setCurrentAgentId(toAgentId);
      setArtifactsInContext(sessionWithMessages.artifacts || []);
      setActivatedTools(
        backfillActivatedToolRequests(
          (sessionWithMessages.activatedTools as SessionActivatedTool[] | undefined)?.length
            ? (sessionWithMessages.activatedTools as SessionActivatedTool[])
            : extractSessionActivatedTools(sessionWithMessages.notes).length
              ? extractSessionActivatedTools(sessionWithMessages.notes)
              : reconstructActivatedToolsFromMessages(sessionWithMessages.messages || []),
          sessionWithMessages.messages || []
        )
      );
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      skipNextSessionLoadRef.current = targetSessionId;
      navigate(`/chat/${toAgentId}/session/${targetSessionId}`, { replace: true });

      const briefing = existingMessages.find(
        (message) => message.handoffType === 'agent-briefing' && message.handoffId
      );
      if (briefing?.handoffId) {
        setScrollToHandoffId(briefing.handoffId);
      }
    } catch (error) {
      console.error('Failed to set up handoff session:', error);
    }

    return true;
  };

  const forwardCodeEditProposalToIde = async (event: CodeEditProposalEvent) => {
    const files = Array.isArray(event.files) ? event.files : [];
    if (files.length === 0) {
      return;
    }

    for (const [index, file] of files.entries()) {
      if (!file?.filePath || typeof file.filePath !== 'string') {
        continue;
      }

      try {
        const openResult = await client.ide.openDiff({
          operationId: `${event.proposalId ?? 'code-edit'}:${index}`,
          filePath: file.filePath,
          agentName: event.agentName ?? currentAgentId ?? 'AI Team',
          description: event.description ?? 'Code edit proposal',
        });

        await client.ide.updateEdit({
          sessionId: openResult.sessionId,
          newContent: file.newContent ?? '',
        });

        void observeIdeLifecycleOutcome(
          openResult.sessionId,
          file.filePath,
          event.agentName ?? currentAgentId
        );
      } catch (error) {
        console.warn('Failed to forward code edit proposal to IDE lifecycle API:', error);
      }
    }
  };

  const observeIdeLifecycleOutcome = async (
    sessionId: string,
    filePath: string,
    agentName?: string
  ) => {
    const maxAttempts = 30;
    const pollIntervalMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const status = (await client.ide.getEditStatus({ sessionId })) as IdeEditSession;

        const terminal =
          'terminalState' in status
            ? (status as { terminalState?: string }).terminalState
            : undefined;
        const isCommitted = status.state === 'committed' || terminal === 'committed';
        const isReverted = status.state === 'reverted' || terminal === 'reverted';

        if (!isCommitted && !isReverted) {
          await delay(pollIntervalMs);
          continue;
        }

        const actionLabel = isCommitted ? 'Kept' : 'Reverted';
        const agentSuffix = agentName ? ` · ${agentName}` : '';

        const toolEvent: SessionActivatedTool = {
          toolName: isCommitted ? 'ide.keep' : 'ide.revert',
          toolPhase: 'result',
          message: `${actionLabel} ${filePath}${agentSuffix}`,
          timestamp: status.lastUpdatedAt || new Date().toISOString(),
        };

        setActivatedTools((previous) => [...previous, toolEvent].slice(-40));
        return;
      } catch {
        // Session may not be available yet; keep polling for a bounded interval.
      }

      await delay(pollIntervalMs);
    }
  };

  const flushTtsBuffer = useCallback(
    (force: boolean, voice?: SpeechSynthesisVoice, rateOverride?: number) => {
      if (!ttsEnabled || !tts.supported) {
        console.debug('[TTS] flush skipped — enabled:', ttsEnabled, 'supported:', tts.supported);
        return;
      }
      const buf = ttsSentenceBuffer.current;
      if (!buf) return;
      const rate = rateOverride ?? ttsRateRef.current;
      if (force) {
        const clean = stripMarkdownForSpeech(buf);
        if (clean) tts.speakChunk(clean, voice, rate);
        ttsSentenceBuffer.current = '';
        return;
      }
      // Split at sentence boundaries: ., !, ?, or double newline
      const boundary = /[.!?](?:\s|$)|\n\n/;
      let rest = buf;
      let match: RegExpExecArray | null;
      while ((match = boundary.exec(rest)) !== null) {
        const end = match.index + match[0].length;
        const sentence = rest.slice(0, end);
        const clean = stripMarkdownForSpeech(sentence);
        if (clean) tts.speakChunk(clean, voice, rate);
        rest = rest.slice(end);
      }
      ttsSentenceBuffer.current = rest;
    },
    [ttsEnabled, tts]
  );

  const consumeStream = async (stream: AsyncIterable<any>, activeSessionId: string | null) => {
    let accumulator = '';
    let handoffDetected = false;
    // Track the active agent ID locally so it updates immediately on handoff,
    // without waiting for React state to re-render.
    let activeAgentId = currentAgentId;
    const getActiveAgent = () => agents.find((a) => a.id === activeAgentId);
    const getVoice = () => (ttsEnabled ? pickVoice(getActiveAgent(), tts.voices) : undefined);
    const getRate = () => getActiveAgent()?.ttsRate ?? ttsRateRef.current;

    for await (const event of stream) {
      if (event.kind === 'handoff') {
        handoffDetected = await handleStreamHandoff(event, activeSessionId);
        if (handoffDetected && event.toAgentId) {
          activeAgentId = event.toAgentId as string;
          // Cancel any buffered speech from the previous agent immediately
          tts.cancel();
          ttsSentenceBuffer.current = '';
        }
        accumulator = '';
        continue;
      }

      if (event.kind === 'token') {
        accumulator += event.text;
        updateAssistantMessageContent(accumulator);
        if (ttsEnabled) {
          ttsSentenceBuffer.current += event.text;
          flushTtsBuffer(false, getVoice(), getRate());
        }
        // Yield to the macrotask queue so React can render this token before
        // the next one arrives. Without this, React 18 automatic batching
        // suppresses all intermediate renders (the whole stream drains as
        // microtasks before React gets a chance to paint).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        continue;
      }

      if (event.kind === 'code_edit_proposal') {
        void forwardCodeEditProposalToIde(event as CodeEditProposalEvent);
        continue;
      }

      if (event.kind === 'tool') {
        const resolvedToolMessage = resolveRuntimeToolEventMessage({
          toolName: event.toolName,
          message: event.message,
          toolResult: event.toolResult,
        });
        const toolEvent: SessionActivatedTool = {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolPhase: event.toolPhase,
          toolEventSeq: event.toolEventSeq,
          message: resolvedToolMessage,
          toolResult: event.toolResult,
          toolDenial: event.toolDenial,
          timestamp: event.timestamp || new Date().toISOString(),
        };
        setActivatedTools((previous) => [...previous, toolEvent].slice(-40));

        if (
          shouldRenderSlashToolMessage({
            toolName: event.toolName,
            toolPhase: event.toolPhase,
            message: resolvedToolMessage,
          })
        ) {
          accumulator =
            accumulator.trim().length > 0
              ? `${accumulator}\n${resolvedToolMessage}`
              : String(resolvedToolMessage);
          updateAssistantMessageContent(accumulator);
        }
        continue;
      }

      if (event.kind === 'session_switched') {
        const newSessionId = event.sessionId as string;
        setCurrentSessionId(newSessionId);
        setMessages([]);
        setIsEphemeral(false);
        await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
        navigate(`/chat/${currentAgentId}/session/${newSessionId}`, { replace: true });
        continue;
      }

      if (event.kind === 'session_title_updated') {
        const eventTitle =
          typeof event.title === 'string' && event.title.trim().length > 0
            ? event.title.trim()
            : null;
        setCurrentSessionTitle(eventTitle);
        await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
        continue;
      }

      if (event.kind === 'error') {
        throw new Error(event.message || 'Chat error');
      }
    }

    // Flush any remaining buffered text after stream ends
    if (ttsEnabled) {
      flushTtsBuffer(true, getVoice(), getRate());
    }

    return { accumulator, handoffDetected };
  };

  const handleSend = async (messageOverride?: string) => {
    const composedMessage = typeof messageOverride === 'string' ? messageOverride : input;
    if (!composedMessage.trim() || sending) {
      return;
    }

    // Cancel any in-flight TTS from the previous response
    tts.cancel();
    ttsSentenceBuffer.current = '';

    const messageContent = composedMessage.trim();
    setChatError(null);
    const userMessage: ChatMessage = {
      from: 'human',
      content: messageContent,
      timestamp: new Date().toISOString(),
    };

    setMessages((previous) => [...previous, userMessage]);
    if (messageOverride === undefined) {
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
    setIsUserScrolledUp(false);
    setSending(true);
    setStreaming(true);
    abortControllerRef.current = new AbortController();

    setMessages((previous) => {
      // Use the functional updater so assistantIndexRef is based on the actual
      // current length (not the stale closure value from `messages`).
      assistantIndexRef.current = previous.length;
      return [
        ...previous,
        {
          from: currentAgentId || 'agent',
          content: '',
          timestamp: new Date().toISOString(),
        },
      ];
    });

    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollTop;
        return;
      }

      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });

    try {
      const sessionId = await ensureSessionForSend();

      const abortSignal = abortControllerRef.current?.signal;
      if (!abortSignal) {
        throw new Error('Chat request was interrupted before it started. Please try again.');
      }

      const stream = client.stream(
        {
          command: 'chat-chat',
          payload: {
            agentId: currentAgentId,
            message: messageContent,
            sessionId: sessionId ?? undefined,
          },
        },
        {
          signal: abortSignal,
          input: askInputQuestion,
          confirm: askConfirmQuestion,
          select: askSelectQuestion,
          password: askPasswordQuestion,
          checklist: askChecklistQuestion,
        }
      );

      const { accumulator, handoffDetected } = await consumeStream(stream, sessionId);

      if (!accumulator && !handoffDetected) {
        updateAssistantMessageContent('No response received.');
      }

      if (sessionId && !handoffDetected) {
        await syncSessionState(sessionId, currentAgentId);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const rawMessage = error instanceof Error ? error.message : 'Failed to send message';
      setChatError(normalizeChatErrorMessage(rawMessage));
      setMessages((previous) => {
        const updated = [...previous];
        const index = assistantIndexRef.current;
        if (index >= 0 && index < updated.length) {
          const currentAssistantMessage = updated[index];
          if (!currentAssistantMessage?.content?.trim()) {
            updated.splice(index, 1);
          }
        }
        return updated;
      });
    } finally {
      setSending(false);
      setStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleSuggestedToolHandoff = async (targetAgentId: string, task?: string) => {
    const trimmedTask = task?.trim();
    const handoffPrompt = trimmedTask
      ? `forward me to ${targetAgentId} about ${trimmedTask}`
      : `forward me to ${targetAgentId}`;
    await handleSend(handoffPrompt);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    requestAnimationFrame(autoResizeTextarea);
  };

  const setTtsRate = useCallback((rate: number) => {
    setTtsRateState(rate);
    ttsRateRef.current = rate;
    try {
      localStorage.setItem('ai-team.ttsRate', String(rate));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ai-team.ttsEnabled', String(next));
      } catch {
        /* storage unavailable */
      }
      if (!next) tts.cancel();
      return next;
    });
  }, [tts]);

  const {
    suggestions: slashSuggestions,
    selectedIndex: slashSelectedIndex,
    isOpen: slashIsOpen,
    navigate: slashNavigate,
    select: slashSelectUsage,
    dismiss: slashDismiss,
  } = useSlashCommandSuggestions(input);

  const handleSlashSelect = (index: number) => {
    const usage = slashSelectUsage(index);
    setInput(usage);
    requestAnimationFrame(autoResizeTextarea);
    textareaRef.current?.focus();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashIsOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        slashNavigate(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        slashNavigate(-1);
        return;
      }
      if (event.key === 'Tab') {
        const idx = Math.max(slashSelectedIndex, 0);
        event.preventDefault();
        handleSlashSelect(idx);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        slashDismiss();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const stopVoiceRecording = useCallback(() => {
    isRecordingRef.current = false;
    setIsRecording(false);
    setInterimTranscript('');
    recognition?.stop();
  }, [recognition]);

  const startVoiceRecording = useCallback(() => {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      globalThis.alert(
        'Speech recognition is not supported in your browser. Please try Chrome or Edge.'
      );
      return;
    }

    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = true;
    recognitionInstance.interimResults = true;
    recognitionInstance.lang = 'en-US';

    recognitionInstance.onstart = () => {
      isRecordingRef.current = true;
      setIsRecording(true);
    };

    recognitionInstance.onresult = (event: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText) {
        setInput((previous) => (previous ? `${previous} ${finalText}` : finalText));
      }
      setInterimTranscript(interimText);
    };

    recognitionInstance.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        isRecordingRef.current = false;
        setIsRecording(false);
        setInterimTranscript('');
        globalThis.alert(
          'Microphone access denied. Please allow microphone access in your browser settings.'
        );
      }
      // For other transient errors (network, no-speech), the onend restart loop handles recovery
    };

    // Chrome stops continuous recognition after ~60s of silence or network hiccup.
    // Restart automatically as long as the user hasn't toggled off.
    recognitionInstance.onend = () => {
      setInterimTranscript('');
      if (isRecordingRef.current) {
        try {
          recognitionInstance.start();
        } catch {
          // already started or permission lost — give up silently
          isRecordingRef.current = false;
          setIsRecording(false);
        }
      }
    };

    setRecognition(recognitionInstance);
    recognitionInstance.start();
  }, []);

  const handleEditMessage = async (index: number) => {
    if (editingIndex === index) {
      try {
        await client.chat.editMessage(currentAgentId, String(index), { content: editContent });
        setMessages((previous) => {
          const updated = [...previous];
          updated[index] = { ...updated[index], content: editContent };
          return updated;
        });
        setEditingIndex(null);
        setEditContent('');
      } catch (error) {
        console.error('Failed to edit message:', error);
      }
      return;
    }

    setEditingIndex(index);
    setEditContent(messages[index].content);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditContent('');
  };

  const handleDeleteMessage = async (index: number) => {
    if (!globalThis.confirm('Delete this message?')) {
      return;
    }
    try {
      const targetMessage = messages[index];
      if (!targetMessage) {
        return;
      }

      if (!currentSessionId) {
        setMessages((previous) => previous.filter((_, messageIndex) => messageIndex !== index));
        return;
      }

      // Always resolve the server-side timestamp before deleting, because
      // React state may hold client-generated timestamps that differ from
      // what is stored in the database.
      const sessionWithMessages = await fetchSessionWithMessages(currentSessionId);
      const persistedMessages = sessionWithMessages?.messages ?? [];
      const persistedMessage = findMatchingMessage(persistedMessages, targetMessage, index);

      if (!persistedMessage) {
        // Message not persisted yet or already deleted — just remove from local state.
        setMessages((previous) => previous.filter((_, messageIndex) => messageIndex !== index));
        return;
      }

      try {
        await client.sessions.deleteMessage(currentSessionId, persistedMessage.timestamp);
      } catch {
        setMessages(persistedMessages);
        return;
      }

      setMessages((previous) => previous.filter((_, messageIndex) => messageIndex !== index));

      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      await syncSessionState(currentSessionId, currentAgentId);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(
      () => console.log('Message copied to clipboard'),
      (error) => console.error('Failed to copy message:', error)
    );
  };

  const handleSpeakMessage = useCallback(
    (content: string, fromAgentId: string, options?: { selected?: boolean }) => {
      if (!tts.supported) return;
      tts.cancel();
      const fromAgent = agents.find((a) => a.id === fromAgentId);
      const voice = pickVoice(fromAgent, tts.voices);
      const rate = fromAgent?.ttsRate ?? ttsRateRef.current;
      const speechText = options?.selected ? content.trim() : stripMarkdownForSpeech(content);
      if (speechText) tts.speakChunk(speechText, voice, rate);
    },
    [tts, agents, ttsRateRef]
  );

  const handleStopSpeaking = useCallback(
    (context: 'message' | 'input' = 'message') => {
      ttsSentenceBuffer.current = '';
      tts.cancel();

      // Input-context stop acts as a persistent streaming auto-read latch.
      // Message-level read controls must remain independent from this latch.
      if (context === 'input') {
        setTtsEnabled(false);
        try {
          localStorage.setItem('ai-team.ttsEnabled', 'false');
        } catch {
          /* storage unavailable */
        }
      }
    },
    [tts]
  );

  const handlePauseSpeaking = useCallback(() => {
    tts.pause();
  }, [tts]);

  const handleResumeSpeaking = useCallback(() => {
    tts.resume();
  }, [tts]);

  const handleToggleArchive = async (index: number, currentlyArchived: boolean) => {
    try {
      const nextHidden = !currentlyArchived;
      if (currentlyArchived) {
        await client.chat.unarchiveMessage(currentAgentId, String(index));
      } else {
        await client.chat.archiveMessage(currentAgentId, String(index));
      }
      setMessages((previous) => {
        const updated = [...previous];
        updated[index] = {
          ...updated[index],
          archived: nextHidden,
          hiddenFromLlm: nextHidden,
        };
        return updated;
      });

      if (currentSessionId) {
        await queryClient.invalidateQueries({
          queryKey: contextPanelQueryKeys.contextEstimate(currentAgentId, currentSessionId),
        });
      }
    } catch (error) {
      console.error('Failed to toggle archive:', error);
    }
  };

  const handleLinkNote = async (messageIndex: number, noteId: string) => {
    if (!currentSessionId) return;
    try {
      const targetMessageId = (messages[messageIndex] as { id?: unknown } | undefined)?.id;
      if (typeof targetMessageId !== 'number') {
        console.warn('Cannot link note: missing numeric message id for index', messageIndex);
        return;
      }
      await client.sessions.linkNote(currentSessionId, noteId, {
        anchorMessageId: targetMessageId,
      });
      await queryClient.invalidateQueries({ queryKey: ['noteShares', currentSessionId] });
    } catch (error) {
      console.error('Failed to link note:', error);
    }
  };

  const handleUnlinkNote = async (_messageIndex: number, noteId: string) => {
    if (!currentSessionId) return;
    try {
      await client.sessions.unlinkNote(currentSessionId, noteId);
      await queryClient.invalidateQueries({ queryKey: ['noteShares', currentSessionId] });
    } catch (error) {
      console.error('Failed to unlink note:', error);
    }
  };

  const handleSummarize = async (
    toIndex: number,
    options?: { compactPercent?: number; focusInstruction?: string }
  ) => {
    setCompressionInProgress(true);
    try {
      if (!currentSessionId) {
        globalThis.alert('No active session. Please start a chat first.');
        return;
      }

      const mode = selectedMessageGroups.length > 0 ? 'selected' : 'visible';
      const selectedMarkdown =
        mode === 'selected' ? selectedMessageGroups.map((g) => g.markdown).join('\n\n') : undefined;

      await client.sessions.compressContext(currentSessionId, {
        toIndex,
        mode,
        selectedMarkdown,
        ...(typeof options?.compactPercent === 'number'
          ? { compactPercent: options.compactPercent }
          : {}),
        ...(options?.focusInstruction?.trim()
          ? { focusInstruction: options.focusInstruction.trim() }
          : {}),
      });

      setSelectedMessageGroups([]);

      if (currentSessionId) {
        await queryClient.invalidateQueries({ queryKey: ['sessionNotes', currentSessionId] });
        await queryClient.invalidateQueries({ queryKey: ['noteShares', currentSessionId] });
        await syncSessionState(currentSessionId, currentAgentId);
        await queryClient.invalidateQueries({
          queryKey: contextPanelQueryKeys.contextEstimate(currentAgentId, currentSessionId),
        });
        await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      }
    } catch (error) {
      console.error('Failed to compress context:', error);
      const rawMessage = error instanceof Error ? error.message : String(error ?? '');
      globalThis.alert(normalizeChatErrorMessage(rawMessage) || 'Failed to compress context.');
    } finally {
      setCompressionInProgress(false);
    }
  };

  const handleToggleToolResultHidden = async (
    messageIndex: number,
    hidden: boolean,
    toolCallId?: number
  ) => {
    try {
      await client.chat.setToolResultHidden(currentAgentId, String(messageIndex), {
        hidden,
        ...(typeof toolCallId === 'number' ? { toolCallId } : {}),
      });

      if (currentSessionId) {
        await syncSessionState(currentSessionId, currentAgentId);
        await queryClient.invalidateQueries({
          queryKey: contextPanelQueryKeys.contextEstimate(currentAgentId, currentSessionId),
        });
      }
    } catch (error) {
      console.error('Failed to toggle tool result visibility:', error);
      globalThis.alert('Failed to update tool result visibility. Please try again.');
    }
  };

  const handleSummarizeToolResult = async (
    messageIndex: number,
    options?: { toolCallId?: number; focusInstruction?: string; maxWords?: number }
  ) => {
    try {
      await client.chat.summarizeToolResult(currentAgentId, String(messageIndex), {
        ...(typeof options?.toolCallId === 'number' ? { toolCallId: options.toolCallId } : {}),
        ...(typeof options?.maxWords === 'number' ? { maxWords: options.maxWords } : {}),
        ...(options?.focusInstruction?.trim()
          ? { focusInstruction: options.focusInstruction.trim() }
          : {}),
      });

      if (currentSessionId) {
        await syncSessionState(currentSessionId, currentAgentId);
        await queryClient.invalidateQueries({
          queryKey: contextPanelQueryKeys.contextEstimate(currentAgentId, currentSessionId),
        });
      }
    } catch (error) {
      console.error('Failed to summarize tool result for LLM context:', error);
      globalThis.alert('Failed to summarize tool result. Please try again.');
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    greetingCancelRef.current.value = true;
    navigate(`/chat/${currentAgentId}/session/${sessionId}`);
  };

  const handleSplitSession = async (atIndex: number) => {
    try {
      if (!currentSessionId) {
        globalThis.alert('No active session. Please start a chat first.');
        return;
      }
      const confirmed = globalThis.confirm(
        `Split session at message ${atIndex + 1}? This will create a new session with messages from that point forward.`
      );
      if (!confirmed) {
        return;
      }
      const newSession = await client.sessions.split(currentSessionId, {
        fromTimestamp: String(atIndex),
        newAgentId: developer?.id || 'clemens-meier',
      });
      setCurrentSessionId(newSession.id);
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      await handleSwitchSession(newSession.id);
      globalThis.alert(`Session split successfully! New session: ${newSession.id}`);
    } catch (error) {
      console.error('Failed to split session:', error);
      globalThis.alert('Failed to split session. Check the console for details.');
    }
  };

  const handleToggleArtifact = async (artifactId: string) => {
    const previousArtifacts = artifactsInContext;
    const updatedArtifacts = previousArtifacts.includes(artifactId)
      ? previousArtifacts.filter((id) => id !== artifactId)
      : [...previousArtifacts, artifactId];
    setArtifactsInContext(updatedArtifacts);

    if (!currentSessionId) {
      return;
    }
    try {
      await client.sessions.update(currentSessionId, { artifacts: updatedArtifacts });
    } catch (error) {
      console.error('Failed to persist artifacts to session:', error);
      setArtifactsInContext(previousArtifacts);
    }
  };

  const handleDeleteSession = (deletedSessionId: string) => {
    if (deletedSessionId === currentSessionId) {
      setCurrentSessionId(null);
      setCurrentSessionTitle(null);
      setMessages([]);
      setArtifactsInContext([]);
      navigate(`/chat/${currentAgentId}`);
    }
  };

  const handleCreateSession = async () => {
    setCurrentSessionId(null);
    setCurrentSessionTitle(null);
    setArtifactsInContext([]);
    setActivatedTools([]);
    setMessages([]);
    setIsEphemeral(false);
    skipNewSessionRef.current = true;
    greetingCancelRef.current.value = true;
    const cancelToken = { value: false };
    greetingCancelRef.current = cancelToken;
    navigate(`/chat/${currentAgentId}`);
    await loadGreeting(currentAgentId, cancelToken);
  };

  const handleHandoffClick = async (targetAgentId: string, existingSessionId?: string | null) => {
    if (existingSessionId) {
      navigate(`/chat/${targetAgentId}/session/${existingSessionId}`);
      return;
    }
    if (!currentSessionId) {
      console.error('Cannot handoff: no current session');
      return;
    }
    try {
      const newSession = await client.sessions.handoff({
        toAgentId: targetAgentId,
        developerId: developer?.id || 'clemens-meier',
        previousSessionId: currentSessionId,
        transferArtifacts: true,
        transferAllowedFiles: true,
      });
      const sessionWithMessages = await fetchSessionWithMessages(newSession.id);
      if (sessionWithMessages) {
        setMessages(sessionWithMessages.messages || []);
        setCurrentSessionId(newSession.id);
        setCurrentSessionTitle(
          typeof sessionWithMessages.title === 'string' &&
            sessionWithMessages.title.trim().length > 0
            ? sessionWithMessages.title.trim()
            : null
        );
        setCurrentAgentId(targetAgentId);
        setArtifactsInContext(sessionWithMessages.artifacts || newSession.artifacts || []);
        setActivatedTools(
          backfillActivatedToolRequests(
            (sessionWithMessages.activatedTools as SessionActivatedTool[] | undefined)?.length
              ? (sessionWithMessages.activatedTools as SessionActivatedTool[])
              : extractSessionActivatedTools(sessionWithMessages.notes).length
                ? extractSessionActivatedTools(sessionWithMessages.notes)
                : reconstructActivatedToolsFromMessages(sessionWithMessages.messages || []),
            sessionWithMessages.messages || []
          )
        );
      }
      navigate(`/chat/${targetAgentId}`);
    } catch (error) {
      console.error('Failed to handle handoff:', error);
    }
  };

  const handleOpenFileReference = async (filePath: string) => {
    const normalized = filePath.trim().replaceAll(/^['"`]|['"`]$/g, '');
    if (!normalized) {
      return;
    }
    try {
      await client.ide.openFile({ filePath: normalized });
    } catch {
      // IDE bridge may be disconnected; keep interaction safe and silent in chat.
    }
  };

  const handleOpenAgentReference = (agentRef: string) => {
    const normalized = agentRef.trim().replace(/^@/, '').toLowerCase();
    const target = agents.find(
      (entry) => entry.id.toLowerCase() === normalized || entry.name.toLowerCase() === normalized
    );
    if (!target) {
      return;
    }
    navigate(`/chat/${target.id}`);
  };

  const handleOpenSessionGraph = (sessionId: string) => {
    navigate(`/chat/${currentAgentId}/session/${sessionId}/thread`);
  };

  const handleOpenNote = (noteId: string, options?: { sessionId?: string; agentId?: string }) => {
    const inferredTarget = threadNoteLookupQuery.data?.[noteId];
    const targetSessionId = options?.sessionId ?? inferredTarget?.sessionId ?? currentSessionId;
    const targetAgentId = options?.agentId ?? inferredTarget?.agentId ?? currentAgentId;
    if (!targetSessionId) return;
    navigate(`/chat/${targetAgentId}/session/${targetSessionId}/note/${noteId}`);
  };

  const handleNoteBack = () => {
    navigate(
      `/chat/${currentAgentId}/session/${currentSessionId ?? ''}`.replace(/\/session\/$/, '')
    );
  };

  const handleSaveInputAsNote = async () => {
    if (!currentSessionId) return;
    try {
      if (selectedMessageGroups.length > 0) {
        const comment = input.trim();
        const noteSections: string[] = [];
        if (comment) {
          noteSections.push('## Comment\n\n' + comment);
        }
        noteSections.push(...selectedMessageGroups.map((group) => group.markdown.trim()));
        const noteContent = noteSections.filter(Boolean).join('\n\n---\n\n').trim();

        if (!noteContent) {
          globalThis.alert('Selected messages did not produce note content.');
          return;
        }

        const created = await client.sessions.createNote(currentSessionId, {
          agentId: currentAgentId,
          title:
            selectedMessageGroups.length === 1
              ? `Message note: ${selectedMessageGroups[0].label}`
              : `Message note (${selectedMessageGroups.length} messages)`,
          content: noteContent,
        });

        setSelectedMessageGroups([]);
        handleInputChange('');
        navigate(
          `/chat/${currentAgentId}/session/${currentSessionId}/note/${(created as { id: string }).id}`
        );
        return;
      }

      if (!input.trim()) return;

      const created = await client.sessions.createNote(currentSessionId, {
        agentId: currentAgentId,
        content: input.trim(),
      });
      handleInputChange('');
      navigate(
        `/chat/${currentAgentId}/session/${currentSessionId}/note/${(created as { id: string }).id}`
      );
    } catch (error) {
      console.error('Failed to save input as note:', error);
      globalThis.alert('Failed to save note. Please try again.');
    }
  };

  const handleToggleMessageGroupSelection = (selection: {
    key: string;
    label: string;
    markdown: string;
  }) => {
    setSelectedMessageGroups((previous) => {
      const existing = previous.find((entry) => entry.key === selection.key);
      if (existing) {
        return previous.filter((entry) => entry.key !== selection.key);
      }
      return [...previous, selection];
    });
  };

  const handleClearMessageGroupSelection = () => {
    setSelectedMessageGroups([]);
  };

  const handleSaveSessionTitle = async (nextTitleRaw: string) => {
    if (!currentSessionId) {
      return;
    }

    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle) {
      globalThis.alert('Title cannot be empty.');
      return;
    }

    try {
      const updated = await client.sessions.update(currentSessionId, { title: nextTitle });
      const persistedTitle =
        typeof (updated as { title?: unknown }).title === 'string' &&
        (updated as { title: string }).title.trim().length > 0
          ? (updated as { title: string }).title.trim()
          : nextTitle;
      setCurrentSessionTitle(persistedTitle);
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
    } catch (error) {
      console.error('Failed to update session title:', error);
      globalThis.alert('Failed to update session title. Please try again.');
    }
  };

  const handleSelectSessionFromGraph = (
    targetSessionId: string,
    targetAgentId: string,
    handoffId?: string
  ) => {
    if (handoffId) {
      setScrollToHandoffId(handoffId);
    }
    const nextAgent = targetAgentId || agentId || currentAgentId;
    if (nextAgent) {
      navigate(`/chat/${nextAgent}/session/${targetSessionId}`);
    }
  };

  useEffect(() => {
    if (!currentSessionId) {
      lastPersistedToolStateRef.current = '';
      return;
    }
    const payload = JSON.stringify(activatedTools);
    if (payload === lastPersistedToolStateRef.current) {
      return;
    }
    lastPersistedToolStateRef.current = payload;
    void client.sessions.update(currentSessionId, { activatedTools }).catch((error) => {
      console.error('Failed to persist activated tools:', error);
    });
  }, [activatedTools, currentSessionId]);

  const handleNavigatePortfolio = () => {
    if (agent) {
      navigate(`/portfolio/${agent.id}`);
    }
  };

  const handleGraphBack = () => {
    navigate(
      `/chat/${currentAgentId}/session/${currentSessionId ?? ''}`.replace(/\/session\/$/, '')
    );
  };

  const messageIndexById = new Map<number, number>();
  messages.forEach((message, index) => {
    const messageId = (message as { id?: unknown }).id;
    if (typeof messageId === 'number') {
      messageIndexById.set(messageId, index);
    }
  });

  const noteSharesByMessageIndex = (noteSharesQuery.data ?? [])
    .filter((share) => share.active && share.anchorMessageId != null)
    .reduce<Record<number, Array<{ noteId: string; label: string }>>>((accumulator, share) => {
      const anchorMessageId = share.anchorMessageId;
      if (anchorMessageId == null) {
        return accumulator;
      }

      const messageIndex = messageIndexById.get(anchorMessageId);
      if (typeof messageIndex !== 'number') {
        return accumulator;
      }
      const noteMeta = threadNoteLookupQuery.data?.[share.noteId];
      const baseLabel = noteMeta?.title ?? share.noteId;
      const label = share.kind === 'compression' ? `summarized context - ${baseLabel}` : baseLabel;
      const labelWithSize = noteMeta?.sizeLabel ? `${label} · ${noteMeta.sizeLabel}` : label;
      const existing = accumulator[messageIndex] ?? [];
      if (!existing.some((entry) => entry.noteId === share.noteId)) {
        accumulator[messageIndex] = [...existing, { noteId: share.noteId, label: labelWithSize }];
      }
      return accumulator;
    }, {});

  return {
    routeAgentId: agentId,
    currentAgentId,
    currentSessionId,
    currentSessionTitle,
    graphSessionId,
    noteRouteId,
    loading,
    sending,
    streaming,
    compressionInProgress,
    messages,
    input,
    editingIndex,
    editContent,
    artifactsInContext,
    toolEntries,
    activatedTools,
    pendingQuestion,
    pendingInputAnswer,
    pendingPasswordAnswer,
    pendingConfirmAnswer,
    pendingSelectAnswer,
    pendingChecklistAnswer,
    pendingFormAnswer,
    isRecording,
    interimTranscript,
    recognition,
    ttsEnabled,
    ttsSupported: tts.supported,
    ttsSpeaking: tts.speaking,
    ttsPaused: tts.paused,
    ttsSpeakingWord: tts.speakingWord,
    ttsSpeakingOccurrence: tts.speakingOccurrence,
    ttsRate: agent?.ttsRate ?? ttsRate,
    setTtsRate,
    toggleTts,
    messagesEndRef,
    messagesContainerRef,
    textareaRef,
    developer,
    agents,
    agent,
    handleNavigatePortfolio,
    handleGraphBack,
    handleSelectSessionFromGraph,
    handleScroll,
    handleSummarize,
    handleSplitSession,
    handleLinkNote,
    handleUnlinkNote,
    noteSharesByMessageIndex,
    setEditContent,
    handleEditMessage,
    handleCancelEdit,
    handleCopyMessage,
    handleSpeakMessage,
    handleStopSpeaking,
    handlePauseSpeaking,
    handleResumeSpeaking,
    handleToggleArchive,
    handleToggleToolResultHidden,
    handleSummarizeToolResult,
    handleDeleteMessage,
    handleHandoffClick,
    handleOpenFileReference,
    handleOpenAgentReference,
    handleSuggestedToolHandoff,
    setPendingInputAnswer,
    setPendingPasswordAnswer,
    setPendingConfirmAnswer,
    setPendingSelectAnswer,
    togglePendingChecklistValue,
    setPendingFormFieldValue,
    handlePendingQuestionSubmit,
    handleConfirmDirectAnswer,
    handleInputChange,
    handleInputKeyDown,
    startVoiceRecording,
    stopVoiceRecording,
    handleSend,
    handleInterrupt,
    dismissChatError: () => setChatError(null),
    chatError,
    handleToggleArtifact,
    handleSwitchSession,
    handleDeleteSession,
    handleCreateSession,
    handleSaveSessionTitle,
    handleOpenSessionGraph,
    handleOpenNote,
    handleNoteBack,
    selectedMessageGroupKeys: selectedMessageGroups.map((entry) => entry.key),
    handleToggleMessageGroupSelection,
    handleClearMessageGroupSelection,
    handleSaveInputAsNote,
    slashSuggestions,
    slashSelectedIndex,
    slashIsOpen,
    handleSlashSelect,
  };
}
