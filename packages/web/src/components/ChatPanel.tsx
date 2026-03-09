import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, useMatch } from 'react-router-dom';
import { useTeam, API_BASE } from '../context/TeamContext';
import { ChatMessage, SessionActivatedTool } from '../types';
import { Avatar } from './Avatar';
import { MarkdownMessage } from './MarkdownMessage';
import { ContextPanel } from './ContextPanel';
import { RelativeTime } from './RelativeTime';
import { SessionGraphLoader } from './SessionGraph';
import { getAgentColor } from '../utils/color';
import { contextPanelQueryKeys } from '../hooks/contextPanelQueryKeys';
import './ChatPanel.css';

/** Match patterns for URL-driven session + graph routing */
const SESSION_ROUTE  = '/chat/:agentId/session/:sessionId';
const GRAPH_ROUTE   = '/chat/:agentId/session/:sessionId/thread';
const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';
const SESSION_META_SUFFIX = ' -->';

function extractSessionActivatedTools(notes?: string): SessionActivatedTool[] {
  if (!notes?.includes(SESSION_META_PREFIX)) return [];
  const start = notes.lastIndexOf(SESSION_META_PREFIX);
  if (start < 0) return [];
  const jsonStart = start + SESSION_META_PREFIX.length;
  const end = notes.indexOf(SESSION_META_SUFFIX, jsonStart);
  if (end < 0) return [];
  try {
    const parsed = JSON.parse(notes.slice(jsonStart, end)) as { activatedTools?: SessionActivatedTool[] };
    return Array.isArray(parsed.activatedTools) ? parsed.activatedTools : [];
  } catch {
    return [];
  }
}

interface QuestionChoice {
  name: string;
  value: string;
}

interface InputQuestionRequest {
  message: string;
}

interface ConfirmQuestionRequest {
  message: string;
  default?: boolean;
}

interface SelectQuestionRequest {
  message: string;
  choices: QuestionChoice[];
}

interface PasswordQuestionRequest {
  message: string;
}

interface ChecklistQuestionRequest {
  message: string;
  choices: QuestionChoice[];
}

type PendingQuestion =
  | {
      kind: 'input';
      message: string;
    }
  | {
      kind: 'password';
      message: string;
    }
  | {
      kind: 'confirm';
      message: string;
      defaultValue: boolean;
    }
  | {
      kind: 'select';
      message: string;
      choices: QuestionChoice[];
    }
  | {
      kind: 'checklist';
      message: string;
      choices: QuestionChoice[];
    };

interface MessageDividerProps {
  messageIndex: number;
  onSummarize: (toIndex: number) => void;
  onSplitSession: (atIndex: number) => void;
}

function MessageDivider({ messageIndex, onSummarize, onSplitSession }: MessageDividerProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className={`message-divider ${isHovered ? 'message-divider-hovered' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="message-divider-line" />
      {isHovered && (
        <div className="message-divider-actions">
          <button
            onClick={() => onSummarize(messageIndex)}
            className="btn-divider-action"
            title="Summarize conversation up to here and create a brief"
          >
            📝 Summarize
          </button>
          <button
            onClick={() => onSplitSession(messageIndex)}
            className="btn-divider-action"
            title="Start a new session from this point"
          >
            ✂️ Split Session
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
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
  const [scrollToHandoffId, setScrollToHandoffId] = useState<string | null>(null);
  // True when a greeting is showing but no session has been persisted yet
  const [isEphemeral, setIsEphemeral] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const lastScrollTopRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingQuestionResolveRef = useRef<((value: unknown) => void) | null>(null);
  const pendingQuestionRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  // Mutable ref tracking current assistant message slot — survives handoff resets
  const assistantIndexRef = useRef<number>(-1);
  // When handleSend lazy-creates a session and navigates to its URL, the URL change would
  // normally re-trigger loadSession and wipe the in-progress stream. We store the
  // just-navigated session ID here so loadSession can skip that one reload.
  const skipNextSessionLoadRef = useRef<string | null>(null);
  const lastPersistedToolStateRef = useRef<string>('');

  // Detect when we are on the graph subroute or session subroute
  const graphRouteMatch   = useMatch(GRAPH_ROUTE);
  const sessionRouteMatch = useMatch(SESSION_ROUTE);
  // sessionId from URL — present on both session and graph routes
  const urlSessionId  = graphRouteMatch?.params?.sessionId ?? sessionRouteMatch?.params?.sessionId ?? null;
  const graphSessionId = graphRouteMatch?.params?.sessionId ?? null;

  const agent = agents.find((a) => a.id === currentAgentId);

  // Auto-resize textarea based on content
  const autoResizeTextarea = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  // Helper: check if message is from human (handles both old 'human' format and new isHuman flag)
  const isHumanMessage = (message: ChatMessage): boolean => {
    return message.isHuman === true || message.from === 'human';
  };

  // Helper: check if message is a handoff (has handoffType or legacy 'to' field or HANDOFF pattern)
  const isHandoffMessage = (message: ChatMessage): boolean => {
    return !!(
      message.handoffType ||
      message.to ||
      /HANDOFF:\s*[a-z0-9-]+\s*\|/i.test(message.content)
    );
  };

  // Helper: check if message is an agent-to-agent briefing
  const isAgentBriefing = (message: ChatMessage): boolean => {
    return message.handoffType === 'agent-briefing';
  };

  // Helper: format developer ID to display name (e.g., "clemens-meier" -> "Clemens Meier")
  const formatDeveloperName = (developerId: string): string => {
    if (developerId === 'human') return 'You'; // Backward compat for old messages
    return developerId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Helper: extract target agent ID from handoff message
  const extractHandoffTarget = (content: string): string | null => {
    const match = content.match(/HANDOFF:\s*([a-z0-9-]+)\s*\|/i);
    return match ? match[1] : null;
  };

  // Resolve which agent to show a "Go to" button for, covering two cases:
  //   1. Message has a HANDOFF directive: target = message.to or extracted from content
  //   2. Message is an agent-briefing FROM a different agent: target = message.from (the sender)
  // Also returns the existing session ID if known, so we navigate there directly.
  const resolveNavigateAgent = (message: ChatMessage): { agent: (typeof agents)[0]; sessionId: string | null } | null => {
    const currentAgent = currentAgentId || agentId;
    // Case 1: outgoing handoff directive
    if (isHandoffMessage(message)) {
      const targetId = message.to || extractHandoffTarget(message.content);
      if (targetId && targetId !== currentAgent) {
        const a = agents.find((ag) => ag.id === targetId);
        if (a) return { agent: a, sessionId: message.handoffToSessionId ?? null };
      }
    }
    // Case 2: incoming agent-briefing authored by a different agent
    if (message.handoffType === 'agent-briefing' && message.from && message.from !== currentAgent) {
      const a = agents.find((ag) => ag.id === message.from);
      if (a) {
        // handoffFromSessionId = the session the briefing came FROM (the other agent's session)
        // handoffToSessionId   = the session the briefing was directed TO (current session)
        // We want to navigate to the OTHER agent's session → handoffFromSessionId
        return { agent: a, sessionId: message.handoffFromSessionId ?? null };
      }
    }
    return null;
  };

  // Handle handoff link click
  const handleHandoffClick = async (targetAgentId: string, existingSessionId?: string | null) => {
    // If the handoff session already exists, navigate directly — do NOT create a new one
    if (existingSessionId) {
      navigate(`/chat/${targetAgentId}/session/${existingSessionId}`);
      return;
    }

    if (!currentSessionId) {
      console.error('Cannot handoff: no current session');
      return;
    }

    try {
      // No existing session found — create a new handoff session
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
      console.log('Created handoff session:', newSession.id);

      // Load messages from the new session
      const messagesResponse = await fetch(`${API_BASE}/api/sessions/${newSession.id}/messages?includeMessages=true`);
      if (messagesResponse.ok) {
        const sessionWithMessages = await messagesResponse.json();
        setMessages(sessionWithMessages.messages || []);
        setCurrentSessionId(newSession.id);
        setCurrentAgentId(targetAgentId);
        setArtifactsInContext(sessionWithMessages.artifacts || newSession.artifacts || []);
        setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
      }

      // Notify parent to switch agent
      // Navigate to the target agent's chat
      navigate(`/chat/${targetAgentId}`);
    } catch (error) {
      console.error('Failed to handle handoff:', error);
    }
  };

  // Open the session thread graph as a subroute
  const handleOpenSessionGraph = (sessionId: string) => {
    const currentAgent = agentId || currentAgentId;
    if (currentAgent) {
      navigate(`/chat/${currentAgent}/session/${sessionId}/thread`);
    }
  };

  // Called when a node is clicked inside the session graph
  const handleSelectSessionFromGraph = (targetSessionId: string, targetAgentId: string, handoffId?: string) => {
    if (handoffId) setScrollToHandoffId(handoffId);
    // Navigate to that session using the correct agent, closes graph view
    const agent = targetAgentId || agentId || currentAgentId;
    if (agent) navigate(`/chat/${agent}/session/${targetSessionId}`);
  };

  /** Fetch the agent introduction and display it as an ephemeral (not-yet-persisted) greeting */
  const loadGreeting = async (targetAgentId: string, cancelled?: { value: boolean }) => {
    try {
      const developerName = encodeURIComponent(developer?.name || 'Developer');
      const res = await fetch(
        `${API_BASE}/api/agents/${targetAgentId}/introduction?developerName=${developerName}`,
      );
      if (cancelled?.value) return;
      if (res.ok) {
        const data = await res.json();
        const greetingMessage: ChatMessage = {
          from: data.agentId ?? targetAgentId,
          content: data.content ?? '',
          timestamp: data.timestamp ?? new Date().toISOString(),
        };
        setMessages([greetingMessage]);
        setIsEphemeral(true);
      } else {
        // Greeting endpoint unavailable — just show an empty chat
        setMessages([]);
        setIsEphemeral(false);
      }
    } catch {
      setMessages([]);
      setIsEphemeral(false);
    }
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
        if (cancelled) return;
        const allowed = response.entries
          .filter((entry) => entry.allowedForAgent === true)
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b));
        setAllowedTools(allowed);
      } catch {
        if (!cancelled) setAllowedTools([]);
      }
    };

    void loadAllowedTools();
    return () => {
      cancelled = true;
    };
  }, [client, currentAgentId]);

  // Scroll to a handoff message identified by handoffId after messages have loaded
  useEffect(() => {
    if (!scrollToHandoffId) return;
    const timer = setTimeout(() => {
      const el = messagesContainerRef.current?.querySelector<HTMLElement>(
        `[data-handoff-id="${scrollToHandoffId}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('handoff-highlight');
        setTimeout(() => el.classList.remove('handoff-highlight'), 1800);
        setScrollToHandoffId(null);
      }
    }, 120); // brief delay for React to flush messages to the DOM
    return () => clearTimeout(timer);
  }, [scrollToHandoffId, messages]);

  // Load chat history — driven by the agentId and URL session ID
  useEffect(() => {
    if (!agentId) return;
    
    let cancelled = false;
    
    const loadSession = async () => {
      // Skip reload if this URL change was caused by our own lazy session creation
      if (urlSessionId && urlSessionId === skipNextSessionLoadRef.current) {
        skipNextSessionLoadRef.current = null;
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // If URL already specifies a session, load that one directly
        const targetUrl = urlSessionId
          ? `${API_BASE}/api/sessions/${urlSessionId}?includeMessages=true`
          : `${API_BASE}/api/sessions/${agentId}/latest?includeMessages=true`;

        const sessionResponse = await fetch(targetUrl);
        
        if (sessionResponse.ok) {
          const sessionWithMessages = await sessionResponse.json();
          const sessionId = sessionWithMessages.id;
          const sessionArtifacts = sessionWithMessages.artifacts || [];
          const sessionMessages = sessionWithMessages.messages || [];
          console.log('Loaded session:', sessionId);
          
          if (!cancelled) {
            setCurrentSessionId(sessionId);
            setMessages(sessionMessages);
            setArtifactsInContext(sessionArtifacts);
            setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
            setCurrentAgentId(agentId);

            // Reflect the session ID in the URL (replace so back button stays clean)
            if (!urlSessionId && sessionId) {
              navigate(`/chat/${agentId}/session/${sessionId}`, { replace: true });
            }
          }
        } else {
          // No session exists yet — show the agent greeting without creating a session
          console.log('No existing session found for agent:', agentId);
          if (!cancelled) {
            setCurrentSessionId(null);
            setArtifactsInContext([]);
            setActivatedTools([]);
            setCurrentAgentId(agentId);
          }
          // loadGreeting has its own cancel guard via the closure flag
          const cancelObj = { value: false };
          if (!cancelled) await loadGreeting(agentId, cancelObj);
          if (cancelled) cancelObj.value = true;
        }
      } catch (error) {
        console.error('Failed to load session:', error);
        if (!cancelled) {
          setCurrentSessionId(null);
          setArtifactsInContext([]);
          setActivatedTools([]);
          setCurrentAgentId(agentId);
          await loadGreeting(agentId);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    loadSession();
    
    return () => {
      cancelled = true;
    };
  }, [agentId, urlSessionId]);

  // Helper: Check if scroll position is at bottom
  const isAtBottom = () => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    // Consider "at bottom" if within 5 pixels
    return scrollHeight - scrollTop - clientHeight < 5;
  };

  // Handle scroll events to detect user scrolling
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const currentScrollTop = container.scrollTop;
    const previousScrollTop = lastScrollTopRef.current;

    // If user scrolled up (even by 1 pixel), stop auto-scroll
    if (currentScrollTop < previousScrollTop) {
      setIsUserScrolledUp(true);
    }
    // If user scrolled to the very bottom, resume auto-scroll
    else if (isAtBottom()) {
      setIsUserScrolledUp(false);
    }

    lastScrollTopRef.current = currentScrollTop;
  };

  useEffect(() => {
    // Only auto-scroll if user hasn't scrolled up
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const rejectAndClearPendingQuestion = (reason: Error) => {
    if (pendingQuestionRejectRef.current) {
      pendingQuestionRejectRef.current(reason);
    }
    clearPendingQuestion();
  };

  const handleInterrupt = () => {
    rejectAndClearPendingQuestion(new Error('Question interrupted by user.'));

    // Abort streaming (the HTTP client forwards this to websocket cancel)
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

  const clearPendingQuestion = () => {
    pendingQuestionResolveRef.current = null;
    pendingQuestionRejectRef.current = null;
    setPendingQuestion(null);
    setPendingInputAnswer('');
    setPendingPasswordAnswer('');
    setPendingConfirmAnswer(false);
    setPendingSelectAnswer('');
    setPendingChecklistAnswer([]);
  };

  const beginPendingQuestion = <T,>(question: PendingQuestion): Promise<T> => {
    if (pendingQuestionRejectRef.current) {
      pendingQuestionRejectRef.current(new Error('Previous question was replaced before submission.'));
    }

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
    }

    setPendingQuestion(question);

    return new Promise<T>((resolve, reject) => {
      pendingQuestionResolveRef.current = (value: unknown) => resolve(value as T);
      pendingQuestionRejectRef.current = reject;
    });
  };

  const togglePendingChecklistValue = (choiceValue: string, checked: boolean) => {
    setPendingChecklistAnswer((prev) =>
      checked ? [...prev, choiceValue] : prev.filter((value) => value !== choiceValue)
    );
  };

  const handlePendingQuestionSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault();

    if (!pendingQuestion || !pendingQuestionResolveRef.current) {
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
    }

    clearPendingQuestion();
  };

  const askInputQuestion = async (request: InputQuestionRequest): Promise<string> => {
    return beginPendingQuestion<string>({ kind: 'input', message: request.message });
  };

  const askConfirmQuestion = async (request: ConfirmQuestionRequest): Promise<boolean> => {
    return beginPendingQuestion<boolean>({ kind: 'confirm', message: request.message, defaultValue: request.default ?? false });
  };

  const askSelectQuestion = async (request: SelectQuestionRequest): Promise<string> => {
    return beginPendingQuestion<string>({ kind: 'select', message: request.message, choices: request.choices });
  };

  const askPasswordQuestion = async (request: PasswordQuestionRequest): Promise<string> => {
    return beginPendingQuestion<string>({ kind: 'password', message: request.message });
  };

  const askChecklistQuestion = async (request: ChecklistQuestionRequest): Promise<string[]> => {
    return beginPendingQuestion<string[]>({ kind: 'checklist', message: request.message, choices: request.choices });
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const messageContent = input.trim();
    // Capture the ephemeral greeting now, before state changes clear it
    const pendingIntroductionContent = isEphemeral ? messages[0]?.content : undefined;

    const userMessage: ChatMessage = {
      from: 'human',
      content: messageContent,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    // Reset scroll lock when user sends a message
    setIsUserScrolledUp(false);
    setSending(true);
    setStreaming(true);
    abortControllerRef.current = new AbortController();

    // Create a placeholder for the streaming response.
    // assistantIndexRef tracks the current slot dynamically so it survives handoff resets.
    assistantIndexRef.current = messages.length + 1;
    const assistantMessage: ChatMessage = {
      from: currentAgentId || 'agent',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Create session if it doesn't exist (lazy session creation)
      let sessionId = currentSessionId;
      if (!sessionId) {
        console.log('Creating new session for first message...');
        const createResponse = await fetch(`${API_BASE}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: currentAgentId,
            developerId: developer?.id || 'clemens-meier',
          }),
        });
        
        if (!createResponse.ok) {
          throw new Error('Failed to create new session');
        }
        
        const newSession = await createResponse.json();
        sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        setIsEphemeral(false);
        void queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
        // Mark this session ID so loadSession skips the redundant reload
        skipNextSessionLoadRef.current = sessionId;
        navigate(`/chat/${currentAgentId}/session/${sessionId}`, { replace: true });
        console.log('Created new session:', sessionId);
      }
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

      let accumulator = '';
      let handoffDetected = false;
      
      for await (const event of stream) {
        if (event.kind === 'handoff') {
          // Agent handoff: server has already created the session and saved the briefing.
          // Use toSessionId from the event to navigate directly — no need to create a new session.
          const fromAgentId = (event as any).fromAgentId;
          const toAgentId = (event as any).toAgentId;
          const toSessionId: string | undefined = (event as any).toSessionId;

          if (toAgentId) {
            handoffDetected = true;
            console.log(`Handoff detected: ${fromAgentId} → ${toAgentId} (session: ${toSessionId ?? 'unknown'})`);

            try {
              let targetSessionId = toSessionId ?? null;

              if (!targetSessionId) {
                // Legacy fallback: server didn't supply toSessionId, create via API
                const handoffResponse = await fetch(`${API_BASE}/api/sessions/handoff`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    toAgentId,
                    developerId: developer?.id || 'clemens-meier',
                    previousSessionId: currentSessionId,
                    transferArtifacts: true,
                    transferAllowedFiles: true,
                  }),
                });
                if (!handoffResponse.ok) throw new Error('Failed to create handoff session');
                const newSession = await handoffResponse.json();
                targetSessionId = newSession.id;
                console.log('Created handoff session (fallback):', targetSessionId);
              }

              // Load messages from the already-existing session (includes the briefing message)
              const messagesResponse = await fetch(`${API_BASE}/api/sessions/${targetSessionId}?includeMessages=true`);
              if (messagesResponse.ok) {
                const sessionWithMessages = await messagesResponse.json();
                const existingMessages: ChatMessage[] = sessionWithMessages.messages || [];
                // Add placeholder for the incoming agent's streaming response
                const newAssistantPlaceholder: ChatMessage = {
                  from: toAgentId,
                  content: '',
                  timestamp: new Date().toISOString(),
                };
                assistantIndexRef.current = existingMessages.length;
                setMessages([...existingMessages, newAssistantPlaceholder]);
                setCurrentSessionId(targetSessionId);
                setCurrentAgentId(toAgentId);
                setArtifactsInContext(sessionWithMessages.artifacts || []);
                setActivatedTools(extractSessionActivatedTools(sessionWithMessages.notes));
                void queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
                // Navigate to the real session URL immediately — no F5 needed
                skipNextSessionLoadRef.current = targetSessionId;
                navigate(`/chat/${toAgentId}/session/${targetSessionId}`, { replace: true });
                // Scroll to the agent-briefing message
                const briefing = existingMessages.find(
                  (m) => m.handoffType === 'agent-briefing' && m.handoffId,
                );
                if (briefing?.handoffId) setScrollToHandoffId(briefing.handoffId);
              }
            } catch (error) {
              console.error('Failed to set up handoff session:', error);
            }

            // Reset accumulator for the new agent's response
            accumulator = '';
          }
        } else if (event.kind === 'token') {
          // Append token to accumulated text
          accumulator += event.text;
          setMessages((prev) => {
            const updated = [...prev];
            const idx = assistantIndexRef.current;
            if (idx >= 0 && idx < updated.length) {
              updated[idx] = {
                ...updated[idx],
                // Do NOT overwrite `from` — the placeholder already has the correct agent ID.
                // Setting it from `currentAgentId` would use a stale closure value after handoff.
                content: accumulator,
              };
            }
            return updated;
          });
        } else if (event.kind === 'status') {
          // Could show status like "thinking..." in UI
          console.log('Status:', event);
        } else if (event.kind === 'tool') {
          const toolEvent: SessionActivatedTool = {
            toolName: event.toolName,
            toolPhase: event.toolPhase,
            message: event.message,
            timestamp: event.timestamp || new Date().toISOString(),
          };
          setActivatedTools((prev) => [...prev, toolEvent].slice(-40));
        } else if (event.kind === 'error') {
          throw new Error(event.message || 'Chat error');
        }
      }

      // If no tokens were received and no handoff, show a message
      if (!accumulator && !handoffDetected) {
        setMessages((prev) => {
          const updated = [...prev];
          const idx = assistantIndexRef.current;
          if (idx >= 0 && idx < updated.length) {
            updated[idx] = {
              ...updated[idx],
              content: 'No response received.',
            };
          }
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const rawMessage = error instanceof Error ? error.message : 'Failed to send message';
      const normalizedMessage = /question timeout|did not receive a response in time/i.test(rawMessage)
        ? 'The request could not be completed. Please try again.'
        : rawMessage;
      const errorMessage: ChatMessage = {
        from: currentAgentId || 'agent',
        content: `Error: ${normalizedMessage}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => {
        const updated = [...prev];
        const idx = assistantIndexRef.current;
        if (idx >= 0 && idx < updated.length) {
          updated[idx] = errorMessage;
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startVoiceRecording = () => {
    // Check if browser supports speech recognition
    const SpeechRecognition = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in your browser. Please try Chrome or Edge.');
      return;
    }

    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = false;
    recognitionInstance.lang = 'en-US';

    recognitionInstance.onstart = () => {
      setIsRecording(true);
    };

    recognitionInstance.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => prev ? `${prev} ${transcript}` : transcript);
    };

    recognitionInstance.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsRecording(false);
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please allow microphone access in your browser settings.');
      }
    };

    recognitionInstance.onend = () => {
      setIsRecording(false);
    };

    setRecognition(recognitionInstance);
    recognitionInstance.start();
  };

  // Message operations
  const handleEditMessage = async (index: number) => {
    if (editingIndex === index) {
      // Save the edit
      try {
        const response = await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent }),
        });

        if (response.ok) {
          setMessages((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], content: editContent };
            return updated;
          });
          setEditingIndex(null);
          setEditContent('');
        }
      } catch (error) {
        console.error('Failed to edit message:', error);
      }
    } else {
      // Start editing
      setEditingIndex(index);
      setEditContent(messages[index].content);
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditContent('');
  };

  const handleDeleteMessage = async (index: number) => {
    if (!confirm('Delete this message?')) return;

    try {
      const targetMessage = messages[index];
      if (!targetMessage) return;

      const response = currentSessionId
        ? await fetch(
            `${API_BASE}/api/sessions/${encodeURIComponent(currentSessionId)}/messages/${encodeURIComponent(targetMessage.timestamp)}`,
            { method: 'DELETE' },
          )
        : await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}`, {
            method: 'DELETE',
          });

      if (response.ok) {
        setMessages((prev) => prev.filter((_, i) => i !== index));
      }
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(
      () => console.log('Message copied to clipboard'),
      (err) => console.error('Failed to copy message:', err)
    );
  };

  const handleToggleArchive = async (index: number, currentlyArchived: boolean) => {
    try {
      const endpoint = currentlyArchived ? 'unarchive' : 'archive';
      const response = await fetch(
        `${API_BASE}/api/chat/${currentAgentId}/messages/${index}/${endpoint}`,
        { method: 'PATCH' }
      );

      if (response.ok) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], archived: !currentlyArchived };
          return updated;
        });
      }
    } catch (error) {
      console.error('Failed to toggle archive:', error);
    }
  };

  // Session operations
  const handleSummarize = async (toIndex: number) => {
    try {
      if (!currentSessionId) {
        alert('No active session. Please start a chat first.');
        return;
      }

      const title = prompt('Enter a title for this brief:');
      if (!title) return;

      // Create a summary from the message content
      const messagesToSummarize = messages.slice(0, toIndex + 1);
      const summary = messagesToSummarize
        .map(
          (m) =>
            `**${isHumanMessage(m) ? formatDeveloperName(m.from) : m.from}** (${new Date(m.timestamp).toLocaleString()}):\n${m.content}`
        )
        .join('\n\n---\n\n');

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

      const artifact = await response.json();
      console.log('Created artifact:', artifact);
      alert(`Brief "${title}" created successfully!`);

      // Reload messages to show updated state
      // TODO: Refresh artifact list in ContextPanel
    } catch (error) {
      console.error('Failed to create summary:', error);
      alert('Failed to create brief. Check the console for details.');
    }
  };

  const handleSplitSession = async (atIndex: number) => {
    try {
      if (!currentSessionId) {
        alert('No active session. Please start a chat first.');
        return;
      }

      const confirmed = confirm(
        `Split session at message ${atIndex + 1}? This will create a new session with messages from that point forward.`
      );
      if (!confirmed) return;

      const response = await fetch(`${API_BASE}/api/sessions/${currentSessionId}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atIndex,
          developerId: developer?.id || 'clemens-meier',
        }),
      });

      if (!response.ok) {
        throw new Error(`Split failed: ${response.statusText}`);
      }

      const newSession = await response.json();
      console.log('Created new session:', newSession);

      // Update current session ID and reload messages from new session
      setCurrentSessionId(newSession.id);
      void queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessionsRoot });
      handleSwitchSession(newSession.id);
      alert(`Session split successfully! New session: ${newSession.id}`);
    } catch (error) {
      console.error('Failed to split session:', error);
      alert('Failed to split session. Check the console for details.');
    }
  };

  const handleToggleArtifact = async (artifactId: string) => {
    const updatedArtifacts = artifactsInContext.includes(artifactId)
      ? artifactsInContext.filter((id) => id !== artifactId)
      : [...artifactsInContext, artifactId];

    // Update local state
    setArtifactsInContext(updatedArtifacts);

    // Persist to session if we have an active session
    if (currentSessionId) {
      try {
        const response = await fetch(`${API_BASE}/api/sessions/${currentSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artifacts: updatedArtifacts }),
        });

        if (!response.ok) {
          throw new Error(`Failed to update session: ${response.statusText}`);
        }

        console.log('Session artifacts updated:', updatedArtifacts);
      } catch (error) {
        console.error('Failed to persist artifacts to session:', error);
        // Revert local state on error
        setArtifactsInContext(artifactsInContext);
      }
    }
  };

  const handleDeleteSession = async (deletedSessionId: string) => {
    if (deletedSessionId === currentSessionId) {
      // Current session was deleted — clear state and go back to agent base URL
      setCurrentSessionId(null);
      setMessages([]);
      setArtifactsInContext([]);
      navigate(`/chat/${agentId || currentAgentId}`);
      console.log('Current session deleted, chat cleared');
    }
  };

  const handleCreateSession = async () => {
    // Do NOT create a session immediately — show the greeting and wait for the first user message
    setCurrentSessionId(null);
    setArtifactsInContext([]);
    setActivatedTools([]);
    setMessages([]);
    setIsEphemeral(false);
    // Navigate to the agent base URL so no stale session ID lingers in the URL
    navigate(`/chat/${currentAgentId}`);
    await loadGreeting(currentAgentId);
    console.log('New ephemeral session started for agent:', currentAgentId);
  };

  const handleSwitchSession = async (sessionId: string) => {
    try {
      // Navigate to the session URL — the URL-driven effect will load messages
      const currentAgent = agentId || currentAgentId;
      navigate(`/chat/${currentAgent}/session/${sessionId}`);
    } catch (error) {
      console.error('Failed to switch session:', error);
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
  }, [currentSessionId, activatedTools]);

  if (!agent) {
    return <div className="error">Agent not found: {currentAgentId}</div>;
  }

  if (loading) {
    return (
      <div className="chat-panel">
        <div className="chat-header">
          <Avatar agent={agent} size="medium" />
          <div className="chat-header-info">
            <h2>Chat with {agent.name}</h2>
            <p className="agent-role">{agent.role}</p>
          </div>
        </div>
        <div className="chat-messages">
          <div className="empty-chat">
            <p>Loading chat history...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel-container">
      <div className="chat-panel">
        <div className="chat-header">
          <Avatar agent={agent} size="medium" />
          <div className="chat-header-info">
            <h2>Chat with {agent.name}</h2>
            <p className="agent-role">{agent.role}</p>
          </div>
          <button
            onClick={() => navigate(`/portfolio/${agent.id}`)}
            className="btn-header-action"
            title="View portfolio"
          >
            <i className="codicon codicon-account" /> Portfolio
          </button>
          {streaming && <span className="streaming-indicator">●</span>}
        </div>

        {graphSessionId ? (
          <>
            <div className="graph-view-header">
              <button
                className="graph-view-back"
              onClick={() => navigate(`/chat/${agentId || currentAgentId}/session/${currentSessionId ?? ''}`.replace(/\/session\/$/, ''))}
              >
                <i className="codicon codicon-arrow-left" /> Back to chat
              </button>
              <span className="graph-view-header-title">Session thread</span>
            </div>
            <div className="chat-messages chat-messages-graph">
              <SessionGraphLoader
                sessionId={graphSessionId}
                activeSessionId={currentSessionId}
                onSelectSession={handleSelectSessionFromGraph}
              />
            </div>
          </>
        ) : (
          <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
            {messages.length === 0 && (
              <div className="empty-chat">
                <p>Start a conversation with {agent.name}</p>
                <div className="agent-info">
                  <strong>Role:</strong> {agent.role}
                </div>
              </div>
            )}

          {messages.map((message, index) => (
            <React.Fragment key={`message-${index}`}>
              {/* Show divider before each message (except the first) */}
              {index > 0 && (
                <MessageDivider
                  key={`divider-${index}`}
                  messageIndex={index}
                  onSummarize={handleSummarize}
                  onSplitSession={handleSplitSession}
                />
              )}
              <div
                className={`message message-${isHumanMessage(message) ? 'user' : 'assistant'}${
                  message.archived ? ' message-archived' : ''
                }`}
                style={(() => {
                  if (isHumanMessage(message)) return undefined;
                  const senderAgent = agents.find((a) => a.id === message.from) ?? agent;
                  return { '--agent-color': getAgentColor(senderAgent) } as React.CSSProperties;
                })()}
                {...(message.handoffId ? { 'data-handoff-id': message.handoffId } : {})}
              >
              <div className="message-avatar">
                {isHumanMessage(message) ? (
                  <div 
                    className={`avatar avatar-small avatar-initials${developer?.portfolioUrl ? ' avatar-clickable' : ''}`}
                    onClick={() => {
                      if (developer?.portfolioUrl) {
                        window.open(developer.portfolioUrl, '_blank');
                      }
                    }}
                    title={developer?.portfolioUrl ? `Visit ${developer.name}'s portfolio` : undefined}
                  >
                    {developer?.avatar ? (
                      <img
                        src={developer.avatar}
                        alt={developer.name}
                        className="avatar avatar-small developer-avatar-img"
                      />
                    ) : (
                      (developer?.name || formatDeveloperName(message.from)).substring(0, 2).toUpperCase()
                    )}
                  </div>
                ) : (
                  <Avatar agent={agents.find((a) => a.id === message.from) ?? agent} size="small" />
                )}
              </div>
              <div className="message-bubble">
                <div className="message-header">
                  <strong>
                    {isHumanMessage(message)
                      ? (developer?.name || formatDeveloperName(message.from))
                      : isAgentBriefing(message) && message.to
                        ? `${(agents.find((a) => a.id === message.from) ?? agent).name} → ${(agents.find((a) => a.id === message.to))?.name ?? message.to}`
                        : (agents.find((a) => a.id === message.from) ?? agent).name
                    }
                  </strong>
                  <RelativeTime timestamp={message.timestamp} className="message-time" />
                  {message.archived && <span className="archived-badge">📦 Archived</span>}
                </div>
                <div className="message-content">
                  {editingIndex === index ? (
                    <div className="message-edit-mode">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="message-edit-textarea"
                        rows={5}
                        title="Edit message content"
                      />
                      <div className="message-edit-actions">
                        <button onClick={() => handleEditMessage(index)} className="btn-save">
                          Save
                        </button>
                        <button onClick={handleCancelEdit} className="btn-cancel">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <MarkdownMessage content={message.content} />
                      {(() => {
                        const nav = resolveNavigateAgent(message);
                        if (!nav) return null;
                        return (
                          <button
                            onClick={() => handleHandoffClick(nav.agent.id, nav.sessionId)}
                            className="btn-handoff-link"
                            title={`Go to ${nav.agent.name}`}
                          >
                            <Avatar agent={nav.agent} size="small" />
                            <span>Go to {nav.agent.name}</span>
                          </button>
                        );
                      })()}
                    </>
                  )}
                </div>
                {editingIndex !== index && (
                  <div className="message-actions">
                    <button
                      onClick={() => handleEditMessage(index)}
                      className="btn-action"
                      title="Edit message"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleCopyMessage(message.content)}
                      className="btn-action"
                      title="Copy raw content"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => handleToggleArchive(index, message.archived || false)}
                      className="btn-action"
                      title={message.archived ? 'Unarchive' : 'Archive (hide from LLM context)'}
                    >
                      {message.archived ? '📂' : '📦'}
                    </button>
                    <button
                      onClick={() => handleDeleteMessage(index)}
                      className="btn-action btn-delete"
                      title="Delete message"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            </div>
            </React.Fragment>
          ))}
          <div ref={messagesEndRef} />
          </div>
        )}

        <div className="chat-input-area">
          {pendingQuestion ? (
            <form className="chat-input-container pending-question-form" onSubmit={handlePendingQuestionSubmit}>
              <div className="pending-question-title">{pendingQuestion.message}</div>

              {pendingQuestion.kind === 'input' && (
                <input
                  type="text"
                  className="pending-question-control pending-question-input"
                  value={pendingInputAnswer}
                  onChange={(e) => setPendingInputAnswer(e.target.value)}
                  placeholder="Enter your answer"
                  title="Answer"
                />
              )}

              {pendingQuestion.kind === 'password' && (
                <input
                  type="password"
                  className="pending-question-control pending-question-input"
                  value={pendingPasswordAnswer}
                  onChange={(e) => setPendingPasswordAnswer(e.target.value)}
                  placeholder="Enter your answer"
                  title="Answer"
                />
              )}

              {pendingQuestion.kind === 'confirm' && (
                <label className="pending-question-control pending-question-confirm">
                  <input
                    type="checkbox"
                    checked={pendingConfirmAnswer}
                    onChange={(e) => setPendingConfirmAnswer(e.target.checked)}
                  />
                  <span>Confirm</span>
                </label>
              )}

              {pendingQuestion.kind === 'select' && (
                <select
                  className="pending-question-control pending-question-select"
                  value={pendingSelectAnswer}
                  onChange={(e) => setPendingSelectAnswer(e.target.value)}
                  title="Choose an option"
                >
                  {pendingQuestion.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              )}

              {pendingQuestion.kind === 'checklist' && (
                <div className="pending-question-control pending-question-checklist">
                  {pendingQuestion.choices.map((choice) => (
                    <label key={choice.value} className="pending-question-checklist-item">
                      <input
                        type="checkbox"
                        checked={pendingChecklistAnswer.includes(choice.value)}
                        onChange={(e) => togglePendingChecklistValue(choice.value, e.target.checked)}
                      />
                      {choice.name}
                    </label>
                  ))}
                </div>
              )}

              <div className="chat-input-actions">
                <button type="submit" className="chat-action-button chat-send-button pending-question-submit">
                  Send answers
                </button>
              </div>
            </form>
          ) : (
            <div className="chat-input-container">
              <textarea
                ref={textareaRef}
                className="chat-input-textarea"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResizeTextarea();
                }}
                onKeyPress={handleKeyPress}
                placeholder={`Ask ${agent.name}...`}
                rows={1}
                disabled={Boolean(pendingQuestion) || (sending && !streaming)}
              />
              <div className="chat-input-actions">
                {streaming ? (
                  <button
                    onClick={handleInterrupt}
                    className="chat-action-button chat-interrupt-button"
                    title="Stop generation"
                  >
                    <i className="codicon codicon-debug-stop" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (isRecording) {
                          recognition?.stop();
                        } else {
                          startVoiceRecording();
                        }
                      }}
                      className={`chat-action-button ${isRecording ? 'chat-recording' : ''}`}
                      title={isRecording ? 'Stop recording' : 'Voice input'}
                      disabled={sending}
                    >
                      <i className={`codicon ${isRecording ? 'codicon-record' : 'codicon-mic'}`} />
                    </button>
                    <button
                      onClick={handleSend}
                      disabled={Boolean(pendingQuestion) || !input.trim() || sending}
                      className="chat-action-button chat-send-button"
                      title="Send message"
                    >
                      <i className="codicon codicon-send" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ContextPanel
        agentId={agentId || currentAgentId}
        sessionId={currentSessionId ?? undefined}
        artifacts={artifactsInContext}
        allowedTools={allowedTools}
        activatedTools={activatedTools}
        onToggleArtifact={handleToggleArtifact}
        onSwitchSession={handleSwitchSession}
        onDeleteSession={handleDeleteSession}
        onCreateSession={handleCreateSession}
        onOpenSessionGraph={handleOpenSessionGraph}
      />
    </div>
  );
}
