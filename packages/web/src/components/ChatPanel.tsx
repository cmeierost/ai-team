import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTeam, API_BASE } from '../context/TeamContext';
import { ChatMessage } from '../types';
import { Avatar } from './Avatar';
import { MarkdownMessage } from './MarkdownMessage';
import { ContextPanel } from './ContextPanel';
import { AgentBriefingBadge } from './AgentBriefingBadge';
import { RelativeTime } from './RelativeTime';
import { getAgentColor } from '../utils/color';
import './ChatPanel.css';

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

function getFallbackQuestionAnswer(question: {
  kind: 'input' | 'password' | 'confirm' | 'select' | 'checklist';
  choices?: QuestionChoice[];
}): string | boolean | string[] {
  if (question.kind === 'confirm') {
    return false;
  }
  if (question.kind === 'checklist') {
    return [];
  }
  if (question.kind === 'select') {
    return question.choices?.[0]?.value ?? '';
  }
  return '';
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
  const [isRecording, setIsRecording] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [pendingInputAnswer, setPendingInputAnswer] = useState('');
  const [pendingPasswordAnswer, setPendingPasswordAnswer] = useState('');
  const [pendingConfirmAnswer, setPendingConfirmAnswer] = useState(false);
  const [pendingSelectAnswer, setPendingSelectAnswer] = useState('');
  const [pendingChecklistAnswer, setPendingChecklistAnswer] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const lastScrollTopRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingQuestionResolveRef = useRef<((value: unknown) => void) | null>(null);
  const pendingQuestionRejectRef = useRef<((reason?: unknown) => void) | null>(null);

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

  // Helper: get target agent name from briefing message
  const getTargetAgentName = (message: ChatMessage): string | null => {
    if (!message.targetAgentId) return null;
    const targetAgent = agents.find((a) => a.id === message.targetAgentId);
    return targetAgent ? targetAgent.name : message.targetAgentId;
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

  // Handle handoff link click
  const handleHandoffClick = async (targetAgentId: string) => {
    if (!currentSessionId) {
      console.error('Cannot handoff: no current session');
      return;
    }

    try {
      // Create a new handoff session
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
      }

      // Notify parent to switch agent
      // Navigate to the target agent's chat
      navigate(`/chat/${targetAgentId}`);
    } catch (error) {
      console.error('Failed to handle handoff:', error);
    }
  };

  // Load chat history when agentId changes
  useEffect(() => {
    if (!agentId) return;
    
    let cancelled = false;
    
    const loadSession = async () => {
      setLoading(true);
      try {
        // Try to get the latest session for this agent (with messages)
        const sessionResponse = await fetch(`${API_BASE}/api/sessions/${agentId}/latest?includeMessages=true`);
        
        if (sessionResponse.ok) {
          // Load existing session with messages
          const sessionWithMessages = await sessionResponse.json();
          const sessionId = sessionWithMessages.id;
          const sessionArtifacts = sessionWithMessages.artifacts || [];
          const sessionMessages = sessionWithMessages.messages || [];
          console.log('Loaded existing session:', sessionId);
          
          if (!cancelled) {
            setCurrentSessionId(sessionId);
            setMessages(sessionMessages);
            setArtifactsInContext(sessionArtifacts);
            setCurrentAgentId(agentId);
          }
        } else {
          // No session exists yet - start fresh
          console.log('No existing session found for agent:', agentId);
          if (!cancelled) {
            setCurrentSessionId(null);
            setMessages([]);
            setArtifactsInContext([]);
            setCurrentAgentId(agentId);
          }
        }
      } catch (error) {
        console.error('Failed to load session:', error);
        // Start fresh on error
        if (!cancelled) {
          setCurrentSessionId(null);
          setMessages([]);
          setArtifactsInContext([]);
          setCurrentAgentId(agentId);
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
  }, [agentId]);

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
    return getFallbackQuestionAnswer({ kind: 'input' }) as string;
  };

  const askConfirmQuestion = async (request: ConfirmQuestionRequest): Promise<boolean> => {
    return getFallbackQuestionAnswer({ kind: 'confirm' }) as boolean;
  };

  const askSelectQuestion = async (request: SelectQuestionRequest): Promise<string> => {
    return getFallbackQuestionAnswer({ kind: 'select', choices: request.choices }) as string;
  };

  const askPasswordQuestion = async (request: PasswordQuestionRequest): Promise<string> => {
    return getFallbackQuestionAnswer({ kind: 'password' }) as string;
  };

  const askChecklistQuestion = async (request: ChecklistQuestionRequest): Promise<string[]> => {
    return getFallbackQuestionAnswer({ kind: 'checklist' }) as string[];
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;

    const messageContent = input.trim();
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

    // Create a placeholder for the streaming response
    const assistantMessageIndex = messages.length + 1;
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
          options: { message: messageContent, sessionId: sessionId ?? undefined },
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
          // Agent handoff detected - create new session and switch to new agent
          const fromAgentId = (event as any).fromAgentId;
          const toAgentId = (event as any).toAgentId;
          const handoffNote = (event as any).handoffNote;
          
          if (toAgentId && currentSessionId) {
            handoffDetected = true;
            console.log(`Handoff detected: switching from ${fromAgentId} to ${toAgentId}`);
            
            try {
              // Create a new handoff session
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

              if (handoffResponse.ok) {
                const newSession = await handoffResponse.json();
                console.log('Created handoff session:', newSession.id);

                // Load messages from the new session
                const messagesResponse = await fetch(`${API_BASE}/api/sessions/${newSession.id}?includeMessages=true`);
                if (messagesResponse.ok) {
                  const sessionWithMessages = await messagesResponse.json();
                  setMessages(sessionWithMessages.messages || []);
                  setCurrentSessionId(newSession.id);
                  setCurrentAgentId(toAgentId);
                  setArtifactsInContext(sessionWithMessages.artifacts || []);
                }
              } else {
                throw new Error('Failed to create handoff session');
              }
            } catch (error) {
              console.error('Failed to create handoff session:', error);
            }
            
            // Reset accumulator for the new agent's response
            accumulator = '';;
          }
        } else if (event.kind === 'token') {
          // Append token to accumulated text
          accumulator += event.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[assistantMessageIndex] = {
              ...updated[assistantMessageIndex],
              from: currentAgentId || 'agent',
              content: accumulator,
            };
            return updated;
          });
        } else if (event.kind === 'status') {
          // Could show status like "thinking..." in UI
          console.log('Status:', event);
        } else if (event.kind === 'tool') {
          // Could show tool usage in UI
          console.log('Tool:', event);
        } else if (event.kind === 'error') {
          throw new Error(event.message || 'Chat error');
        }
      }

      // If no tokens were received and no handoff, show a message
      if (!accumulator && !handoffDetected) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantMessageIndex] = {
            ...updated[assistantMessageIndex],
            content: 'No response received.',
          };
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
        updated[assistantMessageIndex] = errorMessage;
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
      const response = await fetch(`${API_BASE}/api/chat/${currentAgentId}/messages/${index}`, {
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

      // Update current session ID and reload messages
      setCurrentSessionId(newSession.id);
      alert(`Session split successfully! New session: ${newSession.id}`);

      // TODO: Reload messages from new session
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
      // Current session was deleted, clear chat state
      setCurrentSessionId(null);
      setMessages([]);
      setArtifactsInContext([]);
      console.log('Current session deleted, chat cleared');
    }
  };

  const handleCreateSession = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: currentAgentId,
          developerId: developer?.id || 'clemens-meier',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create new session');
      }

      const newSession = await response.json();
      
      // Clear current state and switch to new session
      setMessages([]);
      setArtifactsInContext([]);
      setCurrentSessionId(newSession.id);
      
      console.log('Created new session:', newSession.id);
    } catch (error) {
      console.error('Failed to create new session:', error);
      alert('Failed to create new session. Please try again.');
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    try {
      // Load session with messages in one call
      const sessionResponse = await fetch(`${API_BASE}/api/sessions/${sessionId}?includeMessages=true`);
      if (!sessionResponse.ok) {
        throw new Error('Failed to load session');
      }
      const sessionWithMessages = await sessionResponse.json();

      // Update state
      setCurrentSessionId(sessionId);
      setMessages(sessionWithMessages.messages || []);
      setArtifactsInContext(sessionWithMessages.artifacts || []);
      setCurrentAgentId(sessionWithMessages.agentId || agentId);

      console.log(`Switched to session: ${sessionId}`);
    } catch (error) {
      console.error('Failed to switch session:', error);
      alert('Failed to load session. Check the console for details.');
    }
  };

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
                style={!isHumanMessage(message) && agent ? { '--agent-color': getAgentColor(agent) } as React.CSSProperties : undefined}
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
                  <Avatar agent={agent} size="small" />
                )}
              </div>
              <div className="message-bubble">
                <div className="message-header">
                  <strong>{isHumanMessage(message) ? (developer?.name || formatDeveloperName(message.from)) : agent.name}</strong>
                  {isAgentBriefing(message) && getTargetAgentName(message) && (
                    <AgentBriefingBadge targetAgentName={getTargetAgentName(message)!} />
                  )}
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
                      {isHandoffMessage(message) && (() => {
                        // Use 'to' field if available, otherwise extract from content
                        const targetAgentId = message.to || extractHandoffTarget(message.content);
                        return targetAgentId ? (
                          <button
                            onClick={() => handleHandoffClick(targetAgentId)}
                            className="btn-handoff-link"
                            title={`Switch to ${targetAgentId}`}
                          >
                            → Switch to {targetAgentId}
                          </button>
                        ) : null;
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
        onToggleArtifact={handleToggleArtifact}
        onSwitchSession={handleSwitchSession}
        onDeleteSession={handleDeleteSession}
        onCreateSession={handleCreateSession}
      />
    </div>
  );
}
