import { useState, useEffect } from 'react';
import { TeamGraph } from './components/TeamGraph';
import { AgentList } from './components/AgentList';
import { ChatPanel } from './components/ChatPanel';
import { Portfolio } from './components/Portfolio';
import { TeamProvider } from './context/TeamContext';

export function App() {
  const [view, setView] = useState<'graph' | 'list' | 'chat' | 'portfolio'>('graph');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  return (
    <TeamProvider>
      <div className="app">
        <header className="app-header">
          <h1>🤖 AI Team Dashboard</h1>
          <nav className="app-nav">
            <button
              className={view === 'graph' ? 'active' : ''}
              onClick={() => setView('graph')}
            >
              Organization
            </button>
            <button
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
            >
              Employees
            </button>
            <button
              className={view === 'chat' ? 'active' : ''}
              onClick={() => setView('chat')}
              disabled={!selectedAgent}
            >
              Chat {selectedAgent && `(${selectedAgent})`}
            </button>
          </nav>
        </header>

        <main className="app-main">
          {view === 'graph' && (
            <TeamGraph onSelectAgent={(id) => {
              setSelectedAgent(id);
              setView('chat');
            }} />
          )}
          {view === 'list' && (
            <AgentList 
              onSelectAgent={(id) => {
                setSelectedAgent(id);
                setView('chat');
              }}
              onViewPortfolio={(id) => {
                setSelectedAgent(id);
                setView('portfolio');
              }}
            />
          )}
          {view === 'chat' && selectedAgent && (
            <ChatPanel 
              agentId={selectedAgent}
              onSwitchAgent={(agentId) => setSelectedAgent(agentId)}
            />
          )}
          {view === 'portfolio' && selectedAgent && (
            <Portfolio 
              agentId={selectedAgent} 
              onClose={() => setView('list')}
            />
          )}
        </main>
      </div>
    </TeamProvider>
  );
}
