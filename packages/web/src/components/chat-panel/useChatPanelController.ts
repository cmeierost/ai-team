import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { API_BASE, useTeam } from '../../context/TeamContext';
import { contextPanelQueryKeys } from '../../hooks/contextPanelQueryKeys';
import type { ChatMessage, SessionActivatedTool } from '../../types';
import type { IdeEditStatusResponse } from '@ai-team/api-client-http';
import {
  buildSummaryMarkdown,
  extractSessionActivatedTools,
  findMatchingMessage,
  GRAPH_ROUTE,
  normalizeChatErrorMessage,
  resolveRouteAgent,
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UseChatPanelControllerResult {
  routeAgentId?: string;
  currentAgentId: string;
  currentSessionId: string | null;
  graphSessionId: string | null;
  loading: boolean;
  sending: boolean;
  streaming: boolean;
  messages: ChatMessage[];
  input: string;
  editingIndex: number | null;
  editContent: string;
  artifactsInContext: string[];
  allowedTools: string[];
  activatedTools: SessionActivatedTool[];
  pendingQuestion: PendingQuestion | null;
  pendingInputAnswer: string;
  pendingPasswordAnswer: string;
  pendingConfirmAnswer: boolean;
  pendingSelectAnswer: string;
  pendingChecklistAnswer: string[];
  pendingFormAnswer: Record<string, string>;
  isRecording: boolean;
  recognition: any;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  developer: ReturnType<typeof useTeam>['developer'];
  agents: ReturnType<typeof useTeam>['agents'];
  agent: ReturnType<typeof useTeam>['agents'][number] | undefined;
  handleNavigatePortfolio: () => void;
  handleGraphBack: () => void;
  handleSelectSessionFromGraph: (targetSessionId: string, targetAgentId: string, handoffId?: string) => void;
  handleScroll: () => void;
  handleSummarize: (toIndex: number) => Promise<void>;
  handleSplitSession: (atIndex: number) => Promise<void>;
  setEditContent: (value: string) => void;
  handleEditMessage: (index: number) => Promise<void>;
  handleCancelEdit: () => void;
  handleCopyMessage: (content: string) => void;
  handleToggleArchive: (index: number, currentlyArchived: boolean) => Promise<void>;
  handleDeleteMessage: (index: number) => Promise<void>;
  handleHandoffClick: (targetAgentId: string, existingSessionId?: string | null) => Promise<void>;
  handleSuggestedToolHandoff: (targetAgentId: string, task?: string) => Promise<void>;
  setPendingInputAnswer: (value: string) => void;
  setPendingPasswordAnswer: (value: string) => void;
  setPendingConfirmAnswer: (value: boolean) => void;
  setPendingSelectAnswer: (value: string) => void;
  togglePendingChecklistValue: (choiceValue: string, checked: boolean) => void;
  setPendingFormFieldValue: (fieldId: string, value: string) => void;
  handlePendingQuestionSubmit: (event: { preventDefault(): void }) => void;
  handleInputChange: (value: string) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  startVoiceRecording: () => void;
  handleSend: () => Promise<void>;
  handleInterrupt: () => void;
  handleToggleArtifact: (artifactId: string) => Promise<void>;
  handleSwitchSession: (sessionId: string) => Promise<void>;
  handleDeleteSession: (deletedSessionId: string) => void;
  handleCreateSession: () => Promise<void>;
  handleOpenSessionGraph: (sessionId: string) => void;
}

export function useChatPanelController(): UseChatPanelControllerResult {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents, client, developer } = useTeam();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentAgentId, setCurrentAgentId] = useState(agentId || '');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [artifactsInContext, setArtifactsInContext] = useState<string[]>([]);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [activatedTools, setActivatedTools] = useState<SessionActivatedTool[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingInputAnswer, setPendingInputAnswer] = useState('');
  const [pendingPasswordAnswer, setPendingPasswordAnswer] = useState('');
  const [pendingConfirmAnswer, setPendingConfirmAnswer] = useState(false);
  const [pendingSelectAnswer, setPendingSelectAnswer] = useState('');
  const [pendingChecklistAnswer, setPendingChecklistAnswer] = useState<string[]>([]);
  const [pendingFormAnswer, setPendingFormAnswer] = useState<Record<string, string>>({});
  const [scrollToHandoffId, setScrollToHandoffId] = useState<string | null>(null);
  const [isEphemeral, setIsEphemeral] = useState(false);
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
  const lastPersistedToolStateRef = useRef('');

  const graphRouteMatch = useMatch(GRAPH_ROUTE);
  const sessionRouteMatch = useMatch(SESSION_ROUTE);
  const urlSessionId = graphRouteMatch?.params?.sessionId ?? sessionRouteMatch?.params?.sessionId ?? null;
  const graphSessionId = graphRouteMatch?.params?.sessionId ?? null;

  const agent = agents.find((entry) => entry.id === currentAgentId);

  const autoResizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const loadGreeting = async (targetAgentId: string, cancelled?: { value: boolean }) => {
    try {
      const developerName = encodeURIComponent(developer?.name || 'Developer');
      const response = await fetch(`${API_BASE}/api/agents/${targetAgentId}/introduction?developerName=${developerName}`);
      if (cancelled?.value) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        const greetingMessage: ChatMessage = {
          from: data.agentId ?? targetAgentId,
          content: data.content ?? '',
          timestamp: data.timestamp ?? new Date().toISOString(),
        };
        setMessages([greetingMessage]);
        setIsEphemeral(true);
      } else {
        setMessages([]);
        setIsEphemeral(false);
      }
    } catch {
      setMessages([]);
      setIsEphemeral(false);
    }
  };

  const resetSessionState = (targetAgentId: string) => {
    setCurrentSessionId(null);
    setArtifactsInContext([]);
    setActivatedTools([]);
    setCurrentAgentId(targetAgentId);
  };

  const applyLoadedSession = (targetAgentId: string, sessionWithMessages: any) => {
    setCurrentSessionId(sessionWithMessages.id);
    setMessages(sessionWithMessages.messages || []);
    setArtifactsInContext(sessionWithMessages.artifacts || []);
    setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
    setCurrentAgentId(targetAgentId);
  };

  const loadGreetingFallback = async (targetAgentId: string, cancelled: boolean) => {
    resetSessionState(targetAgentId);
    const cancelObj = { value: false };
    if (!cancelled) {
      await loadGreeting(targetAgentId, cancelObj);
    }
    if (cancelled) {
      cancelObj.value = true;
    }
  };

  const loadPersistedSession = async (targetAgentId: string, targetSessionId: string | null, cancelled: boolean) => {
    const targetUrl = targetSessionId
      ? `${API_BASE}/api/sessions/${targetSessionId}?includeMessages=true`
      : `${API_BASE}/api/sessions/${targetAgentId}/latest?includeMessages=true`;
    const sessionResponse = await fetch(targetUrl);

    if (sessionResponse.ok) {
      const sessionWithMessages = await sessionResponse.json();
      if (!cancelled) {
        applyLoadedSession(targetAgentId, sessionWithMessages);

        if (!targetSessionId && sessionWithMessages.id) {
          navigate(`/chat/${targetAgentId}/session/${sessionWithMessages.id}`, { replace: true });
        }
      }
      return;
    }

    if (!cancelled) {
      await loadGreetingFallback(targetAgentId, cancelled);
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
    const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}?includeMessages=true`);
    if (!response.ok) {
      return null;
    }
    return response.json();
  };

  const syncSessionState = async (sessionId: string, fallbackAgentId: string) => {
    const sessionWithMessages = await fetchSessionWithMessages(sessionId);
    if (!sessionWithMessages) {
      return null;
    }

    applyLoadedSession(getSessionPrimaryAgentId(sessionWithMessages, fallbackAgentId), sessionWithMessages);
    return sessionWithMessages;
  };

  useEffect(() => {
    if (!currentAgentId) {
      setAllowedTools([]);
      return;
    }

    let cancelled = false;
    const loadAllowedTools = async () => {
      try {
        const response = await client.listTools({ agent: currentAgentId });
        if (cancelled) {
          return;
        }
        const allowed = response.entries
          .filter((entry) => entry.allowedForAgent === true)
          .map((entry) => entry.name)
          .sort((left, right) => left.localeCompare(right));
        setAllowedTools(allowed);
      } catch {
        if (!cancelled) {
          setAllowedTools([]);
        }
      }
    };

    void loadAllowedTools();
    return () => {
      cancelled = true;
    };
  }, [client, currentAgentId]);

  useEffect(() => {
    if (!scrollToHandoffId) {
      return;
    }
    const timer = setTimeout(() => {
      const element = messagesContainerRef.current?.querySelector<HTMLElement>(`[data-handoff-id="${scrollToHandoffId}"]`);
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
    if (!agentId) {
      return;
    }

    let cancelled = false;
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

      setLoading(true);
      try {
        await loadPersistedSession(targetAgentId, urlSessionId, cancelled);
      } catch (error) {
        console.error('Failed to load session:', error);
        if (!cancelled) {
          resetSessionState(targetAgentId);
          await loadGreeting(targetAgentId);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [agentId, agents, graphSessionId, navigate, urlSessionId]);

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

  const beginPendingQuestion = <T,>(question: PendingQuestion): Promise<T> => {
    pendingQuestionRejectRef.current?.(new Error('Previous question was replaced before submission.'));

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

  const askInputQuestion = async (request: InputQuestionRequest): Promise<string> => beginPendingQuestion<string>({ kind: 'input', message: request.message });
  const askConfirmQuestion = async (request: ConfirmQuestionRequest): Promise<boolean> => beginPendingQuestion<boolean>({ kind: 'confirm', message: request.message, defaultValue: request.default ?? false });
  const askSelectQuestion = async (request: SelectQuestionRequest): Promise<string> => beginPendingQuestion<string>({
    kind: 'select',
    message: request.message,
    choices: request.choices,
    allowOther: request.allowOther,
    otherLabel: request.otherLabel,
    otherPrompt: request.otherPrompt,
  });
  const askPasswordQuestion = async (request: PasswordQuestionRequest): Promise<string> => beginPendingQuestion<string>({ kind: 'password', message: request.message });
  const askChecklistQuestion = async (request: ChecklistQuestionRequest): Promise<string[]> => beginPendingQuestion<string[]>({
    kind: 'checklist',
    message: request.message,
    choices: request.choices,
    allowOther: request.allowOther,
    otherLabel: request.otherLabel,
    otherPrompt: request.otherPrompt,
  });
  const togglePendingChecklistValue = (choiceValue: string, checked: boolean) => {
    setPendingChecklistAnswer((previous) => (checked ? [...previous, choiceValue] : previous.filter((value) => value !== choiceValue)));
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

  const ensureSessionForSend = async (pendingIntroductionContent?: string) => {
    if (currentSessionId) {
      return currentSessionId;
    }

    const createResponse = await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: currentAgentId,
        developerId: developer?.id || 'clemens-meier',
        ...(pendingIntroductionContent ? { pendingIntroduction: pendingIntroductionContent } : {}),
      }),
    });

    if (!createResponse.ok) {
      throw new Error('Failed to create new session');
    }

    const newSession = await createResponse.json();
    const sessionId = newSession.id as string;
    setCurrentSessionId(sessionId);
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
        const handoffResponse = await fetch(`${API_BASE}/api/sessions/handoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toAgentId,
            developerId: developer?.id || 'clemens-meier',
            previousSessionId: activeSessionId,
            transferArtifacts: true,
            transferAllowedFiles: true,
          }),
        });
        if (!handoffResponse.ok) {
          throw new Error('Failed to create handoff session');
        }
        const newSession = await handoffResponse.json();
        targetSessionId = newSession.id;
      }

      const messagesResponse = await fetch(`${API_BASE}/api/sessions/${targetSessionId}?includeMessages=true`);
      if (!messagesResponse.ok) {
        return true;
      }

      const sessionWithMessages = await messagesResponse.json();
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
      setCurrentAgentId(toAgentId);
      setArtifactsInContext(sessionWithMessages.artifacts || []);
      setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      skipNextSessionLoadRef.current = targetSessionId;
      navigate(`/chat/${toAgentId}/session/${targetSessionId}`, { replace: true });

      const briefing = existingMessages.find((message) => message.handoffType === 'agent-briefing' && message.handoffId);
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
        const openResult = await client.ideOpenDiff({
          operationId: `${event.proposalId ?? 'code-edit'}:${index}`,
          filePath: file.filePath,
          originalContent: file.oldContent ?? '',
          editType: 'modify',
          agentName: event.agentName ?? currentAgentId ?? 'AI Team',
          description: event.description ?? 'Code edit proposal',
        });

        await client.ideUpdateEdit({
          sessionId: openResult.sessionId,
          content: file.newContent ?? '',
          isFinal: true,
        });

        void observeIdeLifecycleOutcome(openResult.sessionId, file.filePath, event.agentName ?? currentAgentId);
      } catch (error) {
        console.warn('Failed to forward code edit proposal to IDE lifecycle API:', error);
      }
    }
  };

  const observeIdeLifecycleOutcome = async (
    sessionId: string,
    filePath: string,
    agentName?: string,
  ) => {
    const maxAttempts = 30;
    const pollIntervalMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const status: IdeEditStatusResponse = await client.ideEditStatus(sessionId);

        const terminal = status.terminalState;
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

  const consumeStream = async (stream: AsyncIterable<any>, activeSessionId: string | null) => {
    let accumulator = '';
    let handoffDetected = false;

    for await (const event of stream) {
      if (event.kind === 'handoff') {
        handoffDetected = await handleStreamHandoff(event, activeSessionId);
        accumulator = '';
        continue;
      }

      if (event.kind === 'token') {
        accumulator += event.text;
        updateAssistantMessageContent(accumulator);
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
        const toolEvent: SessionActivatedTool = {
          toolName: event.toolName,
          toolPhase: event.toolPhase,
          message: event.message,
          toolResult: event.toolResult,
          toolDenial: event.toolDenial,
          timestamp: event.timestamp || new Date().toISOString(),
        };
        setActivatedTools((previous) => [...previous, toolEvent].slice(-40));
        continue;
      }

      if (event.kind === 'error') {
        throw new Error(event.message || 'Chat error');
      }
    }

    return { accumulator, handoffDetected };
  };

  const handleSend = async (messageOverride?: string) => {
    const composedMessage = messageOverride ?? input;
    if (!composedMessage.trim() || sending) {
      return;
    }

    const messageContent = composedMessage.trim();
    const pendingIntroductionContent = isEphemeral ? messages[0]?.content : undefined;
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

    try {
      const sessionId = await ensureSessionForSend(pendingIntroductionContent);

      const abortSignal = abortControllerRef.current?.signal;
      if (!abortSignal) {
        throw new Error('Chat request was interrupted before it started. Please try again.');
      }

      const stream = client.stream({
        command: 'chat',
        payload: {
          employeeId: currentAgentId,
          options: {
            message: messageContent,
            sessionId: sessionId ?? undefined,
            ...(pendingIntroductionContent ? { pendingIntroduction: pendingIntroductionContent } : {}),
          },
        },
      }, {
        signal: abortSignal,
        questionInput: askInputQuestion,
        questionConfirm: askConfirmQuestion,
        questionSelect: askSelectQuestion,
        questionPassword: askPasswordQuestion,
        questionChecklist: askChecklistQuestion,
      });

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
      const errorMessage: ChatMessage = {
        from: currentAgentId || 'agent',
        content: `Error: ${normalizeChatErrorMessage(rawMessage)}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((previous) => {
        const updated = [...previous];
        const index = assistantIndexRef.current;
        if (index >= 0 && index < updated.length) {
          updated[index] = errorMessage;
        } else {
          updated.push(errorMessage);
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

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const startVoiceRecording = () => {
    const SpeechRecognition = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      globalThis.alert('Speech recognition is not supported in your browser. Please try Chrome or Edge.');
      return;
    }

    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = false;
    recognitionInstance.lang = 'en-US';

    recognitionInstance.onstart = () => setIsRecording(true);
    recognitionInstance.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((previous) => (previous ? `${previous} ${transcript}` : transcript));
    };
    recognitionInstance.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
        globalThis.alert('Microphone access denied. Please allow microphone access in your browser settings.');
      }
    };
    recognitionInstance.onend = () => setIsRecording(false);

    setRecognition(recognitionInstance);
    recognitionInstance.start();
  };

  const handleEditMessage = async (index: number) => {
    if (editingIndex === index) {
      try {
        const response = await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent }),
        });
        if (response.ok) {
          setMessages((previous) => {
            const updated = [...previous];
            updated[index] = { ...updated[index], content: editContent };
            return updated;
          });
          setEditingIndex(null);
          setEditContent('');
        }
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
        const response = await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}`, { method: 'DELETE' });
        if (response.ok) {
          setMessages((previous) => previous.filter((_, messageIndex) => messageIndex !== index));
        }
        return;
      }

      let timestampToDelete = targetMessage.timestamp;
      let response = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(currentSessionId)}/messages/${encodeURIComponent(timestampToDelete)}`,
        { method: 'DELETE' },
      );

      if (response.ok) {
        setMessages((previous) => previous.filter((_, messageIndex) => messageIndex !== index));
      } else {
        const sessionWithMessages = await fetchSessionWithMessages(currentSessionId);
        const persistedMessages = sessionWithMessages?.messages ?? [];
        const persistedMessage = findMatchingMessage(persistedMessages, targetMessage, index);

        if (!persistedMessage) {
          setMessages(persistedMessages);
          return;
        }

        timestampToDelete = persistedMessage.timestamp;
        response = await fetch(
          `${API_BASE}/api/sessions/${encodeURIComponent(currentSessionId)}/messages/${encodeURIComponent(timestampToDelete)}`,
          { method: 'DELETE' },
        );

        if (!response.ok) {
          setMessages(persistedMessages);
          return;
        }

        setMessages((previous) => {
          const matchedIndex = previous[index]?.timestamp === timestampToDelete
            ? index
            : previous.findIndex((message, messageIndex) => {
                if (messageIndex === index && message.timestamp === timestampToDelete) {
                  return true;
                }
                return message.timestamp === timestampToDelete && findMatchingMessage([message], targetMessage, 0) !== null;
              });
          return matchedIndex >= 0
            ? previous.filter((_, messageIndex) => messageIndex !== matchedIndex)
            : previous.filter((_, messageIndex) => messageIndex !== index);
        });
      }

      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      await syncSessionState(currentSessionId, currentAgentId);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(
      () => console.log('Message copied to clipboard'),
      (error) => console.error('Failed to copy message:', error),
    );
  };

  const handleToggleArchive = async (index: number, currentlyArchived: boolean) => {
    try {
      const endpoint = currentlyArchived ? 'unarchive' : 'archive';
      const response = await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}/${endpoint}`, { method: 'PATCH' });
      if (response.ok) {
        setMessages((previous) => {
          const updated = [...previous];
          updated[index] = { ...updated[index], archived: !currentlyArchived };
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to toggle archive:', error);
    }
  };

  const handleSummarize = async (toIndex: number) => {
    try {
      if (!currentSessionId) {
        globalThis.alert('No active session. Please start a chat first.');
        return;
      }
      const title = globalThis.prompt('Enter a title for this brief:');
      if (!title) {
        return;
      }
      const summary = buildSummaryMarkdown(messages.slice(0, toIndex + 1), developer?.name || undefined);
      const response = await fetch(`${API_BASE}/api/sessions/${currentSessionId}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromIndex: 0,
          toIndex,
          title,
          summary,
          developerId: developer?.id || 'clemens-meier',
        }),
      });
      if (!response.ok) {
        throw new Error(`Summarize failed: ${response.statusText}`);
      }
      await response.json();
      globalThis.alert(`Brief "${title}" created successfully!`);
    } catch (error) {
      console.error('Failed to create summary:', error);
      globalThis.alert('Failed to create brief. Check the console for details.');
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    navigate(`/chat/${currentAgentId}/session/${sessionId}`);
  };

  const handleSplitSession = async (atIndex: number) => {
    try {
      if (!currentSessionId) {
        globalThis.alert('No active session. Please start a chat first.');
        return;
      }
      const confirmed = globalThis.confirm(`Split session at message ${atIndex + 1}? This will create a new session with messages from that point forward.`);
      if (!confirmed) {
        return;
      }
      const response = await fetch(`${API_BASE}/api/sessions/${currentSessionId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atIndex, developerId: developer?.id || 'clemens-meier' }),
      });
      if (!response.ok) {
        throw new Error(`Split failed: ${response.statusText}`);
      }
      const newSession = await response.json();
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
      const response = await fetch(`${API_BASE}/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifacts: updatedArtifacts }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update session: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to persist artifacts to session:', error);
      setArtifactsInContext(previousArtifacts);
    }
  };

  const handleDeleteSession = (deletedSessionId: string) => {
    if (deletedSessionId === currentSessionId) {
      setCurrentSessionId(null);
      setMessages([]);
      setArtifactsInContext([]);
      navigate(`/chat/${currentAgentId}`);
    }
  };

  const handleCreateSession = async () => {
    setCurrentSessionId(null);
    setArtifactsInContext([]);
    setActivatedTools([]);
    setMessages([]);
    setIsEphemeral(false);
    navigate(`/chat/${currentAgentId}`);
    await loadGreeting(currentAgentId);
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
      const response = await fetch(`${API_BASE}/api/sessions/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toAgentId: targetAgentId,
          developerId: developer?.id || 'clemens-meier',
          previousSessionId: currentSessionId,
          transferArtifacts: true,
          transferAllowedFiles: true,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to create handoff session');
      }
      const newSession = await response.json();
      const messagesResponse = await fetch(`${API_BASE}/api/sessions/${newSession.id}/messages?includeMessages=true`);
      if (messagesResponse.ok) {
        const sessionWithMessages = await messagesResponse.json();
        setMessages(sessionWithMessages.messages || []);
        setCurrentSessionId(newSession.id);
        setCurrentAgentId(targetAgentId);
        setArtifactsInContext(sessionWithMessages.artifacts || newSession.artifacts || []);
        setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
      }
      navigate(`/chat/${targetAgentId}`);
    } catch (error) {
      console.error('Failed to handle handoff:', error);
    }
  };

  const handleOpenSessionGraph = (sessionId: string) => {
    navigate(`/chat/${currentAgentId}/session/${sessionId}/thread`);
  };

  const handleSelectSessionFromGraph = (targetSessionId: string, targetAgentId: string, handoffId?: string) => {
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
    void fetch(`${API_BASE}/api/sessions/${currentSessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activatedTools }),
    }).catch((error) => {
      console.error('Failed to persist activated tools:', error);
    });
  }, [activatedTools, currentSessionId]);

  const handleNavigatePortfolio = () => {
    if (agent) {
      navigate(`/portfolio/${agent.id}`);
    }
  };

  const handleGraphBack = () => {
    navigate(`/chat/${currentAgentId}/session/${currentSessionId ?? ''}`.replace(/\/session\/$/, ''));
  };

  return {
    routeAgentId: agentId,
    currentAgentId,
    currentSessionId,
    graphSessionId,
    loading,
    sending,
    streaming,
    messages,
    input,
    editingIndex,
    editContent,
    artifactsInContext,
    allowedTools,
    activatedTools,
    pendingQuestion,
    pendingInputAnswer,
    pendingPasswordAnswer,
    pendingConfirmAnswer,
    pendingSelectAnswer,
    pendingChecklistAnswer,
    pendingFormAnswer,
    isRecording,
    recognition,
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
    setEditContent,
    handleEditMessage,
    handleCancelEdit,
    handleCopyMessage,
    handleToggleArchive,
    handleDeleteMessage,
    handleHandoffClick,
    handleSuggestedToolHandoff,
    setPendingInputAnswer,
    setPendingPasswordAnswer,
    setPendingConfirmAnswer,
    setPendingSelectAnswer,
    togglePendingChecklistValue,
    setPendingFormFieldValue,
    handlePendingQuestionSubmit,
    handleInputChange,
    handleInputKeyDown,
    startVoiceRecording,
    handleSend,
    handleInterrupt,
    handleToggleArtifact,
    handleSwitchSession,
    handleDeleteSession,
    handleCreateSession,
    handleOpenSessionGraph,
  };
}
