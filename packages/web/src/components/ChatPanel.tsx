import { useState, useEffect, useRef } from 'react';
import { useTeam, API_BASE } from '../context/TeamContext';
import { ChatMessage } from '../types';
import { Avatar } from './Avatar';
import { MarkdownMessage } from './MarkdownMessage';
import { ContextPanel } from './ContextPanel';
import './ChatPanel.css';

interface ChatPanelProps {
  agentId: string;
  onSwitchAgent?: (agentId: string) => void;
}

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

export function ChatPanel({ agentId, onSwitchAgent }: ChatPanelProps) {
  const { agents, client } = useTeam();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentAgentId, setCurrentAgentId] = useState(agentId);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [artifactsInContext, setArtifactsInContext] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === currentAgentId);

  // Helper: check if message is from human (handles both old 'human' format and new isHuman flag)
  const isHumanMessage = (message: ChatMessage): boolean => {
    return message.isHuman === true || message.from === 'human';
  };

  // Helper: check if message is a handoff (has 'to' field or HANDOFF pattern in content)
  const isHandoffMessage = (message: ChatMessage): boolean => {
    return !!(message.to || /HANDOFF:\s*[a-z0-9-]+\s*\|/i.test(message.content));
  };

  // Helper: format developer ID to display name (e.g., "clemens-meier" -> "Clemens Meier")
  const formatDeveloperName = (developerId: string): string => {
    if (developerId === 'human') return 'You'; // Backward compat for old messages
    return developerId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Helper: format timestamp as relative date/time
  const formatRelativeTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    // Less than 1 minute: "just now"
    if (diffSecs < 60) return 'just now';
    
    // Less than 1 hour: "X min ago"
    if (diffMins < 60) return `${diffMins} min ago`;
    
    // Less than 24 hours: show time only
    if (diffHours < 24) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    
    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Within the last 7 days: show day name + time
    if (diffDays < 7) {
      return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    // Within current year: show month + day
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    
    // Older: show full date
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Helper: extract target agent ID from handoff message
  const extractHandoffTarget = (content: string): string | null => {
    const match = content.match(/HANDOFF:\s*([a-z0-9-]+)\s*\|/i);
    return match ? match[1] : null;
  };

  // Handle handoff link click
  const handleHandoffClick = (targetAgentId: string) => {
    if (onSwitchAgent) {
      onSwitchAgent(targetAgentId);
    }
  };

  // Load chat history when agentId changes
  useEffect(() => {
    let cancelled = false;
    
    const loadSession = async () => {
      setLoading(true);
      try {
        // Try to get the latest session for this agent
        const sessionResponse = await fetch(`${API_BASE}/api/sessions/${agentId}/latest`);
        
        let sessionId: string;
        let sessionArtifacts: string[] = [];
        
        if (sessionResponse.ok) {
          const session = await sessionResponse.json();
          sessionId = session.id;
          sessionArtifacts = session.artifacts || [];
          console.log('Loaded existing session:', sessionId);
        } else {
          // No session exists, create a new one
          const createResponse = await fetch(`${API_BASE}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId,
              developerId: 'clemens.meier', // TODO: Get from user context
            }),
          });
          
          if (!createResponse.ok) {
            throw new Error('Failed to create new session');
          }
          
          const newSession = await createResponse.json();
          sessionId = newSession.id;
          sessionArtifacts = newSession.artifacts || [];
          console.log('Created new session:', sessionId);
        }
        
        // Load messages from the session
        const messagesResponse = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
        if (!messagesResponse.ok) {
          console.error('Failed to load session messages');
          return;
        }
        
        const sessionMessages = await messagesResponse.json();
        
        if (!cancelled) {
          setCurrentSessionId(sessionId);
          setMessages(sessionMessages);
          setArtifactsInContext(sessionArtifacts);
          setCurrentAgentId(agentId);
        }
      } catch (error) {
        console.error('Failed to load session:', error);
        // Fallback to old chat history if session loading fails
        try {
          const response = await fetch(`${API_BASE}/api/chat/${agentId}?includeArchived=true`);
          if (response.ok) {
            const history = await response.json();
            if (!cancelled) {
              setMessages(history);
              setCurrentAgentId(agentId);
            }
          }
        } catch (fallbackError) {
          console.error('Fallback to old chat history also failed:', fallbackError);
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
    setStreaming(true);

    // Create a placeholder for the streaming response
    const assistantMessageIndex = messages.length + 1;
    const assistantMessage: ChatMessage = {
      from: currentAgentId,
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Stream the response using WebSocket
      const stream = client.stream({
        command: 'chat',
        payload: {
          employeeId: currentAgentId,
          options: { message: messageContent },
        },
      });

      let accumulator = '';
      let handoffDetected = false;
      
      for await (const event of stream) {
        if (event.kind === 'handoff') {
          // Agent handoff detected - switch to new agent
          const toAgentId = (event as any).toAgentId;
          const handoffNote = (event as any).handoffNote;
          
          if (toAgentId) {
            handoffDetected = true;
            console.log(`Handoff detected: switching to ${toAgentId}`);
            
            // Load the new agent's chat history
            try {
              const response = await fetch(`${API_BASE}/api/chat/${toAgentId}`);
              if (response.ok) {
                const history = await response.json();
                setMessages(history);
                setCurrentAgentId(toAgentId);
              }
            } catch (error) {
              console.error('Failed to load new agent chat history:', error);
            }
            
            // Reset accumulator for the new agent's response
            accumulator = '';
          }
        } else if (event.kind === 'token') {
          // Append token to accumulated text
          accumulator += event.text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[assistantMessageIndex] = {
              ...updated[assistantMessageIndex],
              from: currentAgentId,
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
      const errorMessage: ChatMessage = {
        from: currentAgentId,
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
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
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          developerId: 'clemens.meier', // TODO: Get from user context
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
          developerId: 'clemens.meier', // TODO: Get from user context
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

  const handleSwitchSession = async (sessionId: string) => {
    try {
      // Load session metadata
      const sessionResponse = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
      if (!sessionResponse.ok) {
        throw new Error('Failed to load session');
      }
      const session = await sessionResponse.json();

      // Load messages from the session
      const messagesResponse = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
      if (!messagesResponse.ok) {
        throw new Error('Failed to load session messages');
      }
      const sessionMessages = await messagesResponse.json();

      // Update state
      setCurrentSessionId(sessionId);
      setMessages(sessionMessages);
      setArtifactsInContext(session.artifacts || []);

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
          {streaming && <span className="streaming-indicator">●</span>}
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
            <>
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
                key={index}
                className={`message message-${isHumanMessage(message) ? 'user' : 'assistant'}${
                  message.archived ? ' message-archived' : ''
                }`}
              >
              <div className="message-avatar">
                {isHumanMessage(message) ? (
                  <div className="avatar avatar-small avatar-initials">
                    {formatDeveloperName(message.from).substring(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <Avatar agent={agent} size="small" />
                )}
              </div>
              <div className="message-bubble">
                <div className="message-header">
                  <strong>{isHumanMessage(message) ? formatDeveloperName(message.from) : agent.name}</strong>
                  <span className="message-time">
                    {formatRelativeTime(message.timestamp)}
                  </span>
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
            </>
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

      <ContextPanel
        agentId={agentId}
        sessionId={currentSessionId ?? undefined}
        artifacts={artifactsInContext}
        onToggleArtifact={handleToggleArtifact}
        onSwitchSession={handleSwitchSession}
      />
    </div>
  );
}
