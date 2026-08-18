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
  const detail = import.meta.env.DEV && error.stack ? error.stack : error.message;
  return (
    <main className="recovery-screen" role="alert">
      <h1>Elef needs to recover</h1>
      <p>The application hit an unexpected error. Your Markdown source was not discarded.</p>
      <pre>{detail}</pre>
      <button type="button" onClick={() => window.location.reload()}>Reload Elef</button>
    </main>
  );
}

export function installGlobalErrorReporter(onError: (error: Error) => void) {
  const handleError = (event: ErrorEvent) => onError(errorFrom(event.error || event.message));
  const handleRejection = (event: PromiseRejectionEvent) => onError(errorFrom(event.reason));
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}
