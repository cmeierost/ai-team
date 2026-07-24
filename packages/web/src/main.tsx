import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { useBackendConnectionStore } from './stores/backendConnectionStore';
import { installFrontendErrorReporting, reportFrontendError } from './frontend-log';
import './styles.css';

const handleQuerySuccess = () => {
  const { isReachable, setReachable } = useBackendConnectionStore.getState();
  if (!isReachable) setReachable(true);
};

const handleQueryError = (error: unknown) => {
  reportFrontendError(error, { phase: 'query' });
  if (
    error instanceof Error &&
    (error.message.includes('fetch') ||
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch') ||
      error.message.includes('Load failed'))
  ) {
    useBackendConnectionStore.getState().setReachable(false);
  }
};

installFrontendErrorReporting();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onSuccess: handleQuerySuccess,
    onError: handleQueryError,
  }),
  mutationCache: new MutationCache({
    onSuccess: handleQuerySuccess,
    onError: handleQueryError,
  }),
});
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
