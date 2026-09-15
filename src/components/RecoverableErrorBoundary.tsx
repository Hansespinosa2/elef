import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'Unknown application error');
}

export class RecoverableErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('[elef] render failure', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <RecoveryScreen error={this.state.error} />;
    }
    return this.props.children;
  }
}

export function RecoveryScreen({ error }: { error: Error }) {
  const detail = import.meta.env.DEV && error.stack ? error.stack : 'Unexpected application error.';
  return (
    <main className="recovery-screen" role="alert">
      <h1>Elef needs to recover</h1>
      <p>The application stopped rendering safely. Reload Elef to continue.</p>
      <pre>{detail}</pre>
      <button type="button" onClick={() => window.location.reload()}>Reload Elef</button>
    </main>
  );
}

export function installGlobalErrorReporter(onError: (error: Error) => void) {
  const handleError = (event: ErrorEvent) => {
    if (event.error) onError(errorFrom(event.error));
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    if (event.reason instanceof DOMException && event.reason.name === 'AbortError') return;
    onError(errorFrom(event.reason));
  };
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}
