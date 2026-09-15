import { StrictMode, type ReactNode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RecoverableErrorBoundary, RecoveryScreen, installGlobalErrorReporter } from './components/RecoverableErrorBoundary';

function Root({ children }: { children: ReactNode }) {
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => installGlobalErrorReporter(setError), []);
  if (error) return <RecoveryScreen error={error} />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoverableErrorBoundary>
      <Root><App /></Root>
    </RecoverableErrorBoundary>
  </StrictMode>,
);
