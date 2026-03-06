import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { TeamGraph } from './components/TeamGraph';
import { AgentList } from './components/AgentList';
import { ChatPanel } from './components/ChatPanel';
import { Portfolio } from './components/Portfolio';
import { NotFound } from './components/NotFound';
import { Sidebar } from './components/Sidebar';
import { SessionGraphPreview } from './components/SessionGraphPreview';
import { TeamProvider } from './context/TeamContext';
import './App.css';

export function App() {
  return (
    <TeamProvider>
      <div className="app">
        <Sidebar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/organization" element={<TeamGraph />} />
            <Route path="/employees" element={<AgentList />} />
            <Route path="/chat/:agentId/*" element={<ChatPanel />} />
            <Route path="/portfolio/:agentId" element={<Portfolio />} />
            <Route path="/dev/session-graph" element={<SessionGraphPreview />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </TeamProvider>
  );
}
