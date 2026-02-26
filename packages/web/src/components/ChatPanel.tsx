import { useState, useEffect, useRef } from 'react';
import { useTeam } from '../context/TeamContext';
import { ChatMessage } from '../types';

const API_BASE = 'http://localhost:3002/api';

interface ChatPanelProps {
  agentId: string;
}

interface ApiQuestionPayload {
  kind: 'question';
  message?: string;
  questionType?: string;
  choices?: Array<{ name: string; value: string }>;
}

interface ApiErrorPayload {
  kind: 'error';
  message?: string;
}

function isApiQuestionPayload(value: unknown): value is ApiQuestionPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (value as { kind?: unknown }).kind === 'question';
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (value as { kind?: unknown }).kind === 'error';
}

function toChatMessage(payload: unknown, agentId: string): ChatMessage {
  if (isApiQuestionPayload(payload)) {
    const choices = Array.isArray(payload.choices) && payload.choices.length > 0
      ? `\n\n${payload.choices.map((choice, index) => `${index + 1}. ${choice.name}`).join('\n')}`
      : '';

    return {
      from: agentId,
      content: `${payload.message || 'Question from service'}${choices}`,
      timestamp: new Date().toISOString(),
    };
  }

  if (isApiErrorPayload(payload)) {
    return {
      from: agentId,
      content: `Error: ${payload.message || 'Request failed'}`,
      timestamp: new Date().toISOString(),
    };
  }

  if (payload && typeof payload === 'object') {
    const maybeMessage = payload as Partial<ChatMessage>;
    if (typeof maybeMessage.content === 'string') {
      return {
        from: typeof maybeMessage.from === 'string' ? maybeMessage.from : agentId,
        content: maybeMessage.content,
        timestamp: typeof maybeMessage.timestamp === 'string' ? maybeMessage.timestamp : new Date().toISOString(),
      };
    }
  }

  return {
    from: agentId,
    content: 'Received unexpected response payload from server.',
    timestamp: new Date().toISOString(),
  };
}

export function ChatPanel({ agentId }: ChatPanelProps) {
  const { agents } = useTeam();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === agentId);

  useEffect(() => {
    // Load chat history
    const loadHistory = async () => {
      try {
        const response = await fetch(`${API_BASE}/chat/${agentId}`);
        if (response.ok) {
          const history = await response.json();
          setMessages(history);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    };
    loadHistory();
  }, [agentId]);

  useEffect(() => {
    // Scroll to bottom on new messages
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    setSending(true);

    try {
      const response = await fetch(`${API_BASE}/chat/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageContent }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const payload = await response.json();
      const assistantMessage: ChatMessage = toChatMessage(payload, agentId);
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: ChatMessage = {
        from: agentId,
        content: 'Error: Failed to send message',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!agent) {
    return <div className="error">Agent not found: {agentId}</div>;
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Chat with {agent.name}</h2>
        <p className="agent-role">{agent.role}</p>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-chat">
            <p>Start a conversation with {agent.name}</p>
            <div className="agent-info">
              <strong>Role:</strong> {agent.role}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`message message-${message.from === 'human' ? 'user' : 'assistant'}`}
          >
            <div className="message-header">
              <strong>{message.from === 'human' ? 'You' : agent.name}</strong>
              <span className="message-time">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="message-content">{message.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={`Message ${agent.name}...`}
          rows={3}
          disabled={sending}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="btn-send"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
