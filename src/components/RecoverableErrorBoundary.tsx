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
    <main className="recovery-screen grid min-h-screen place-content-center gap-4 bg-app-bg p-8 text-text" role="alert">
      <h1 className="font-display text-text-strong">Elef needs to recover</h1>
      <p>The application stopped rendering safely. Reload Elef to continue.</p>
      <pre className="max-w-[70rem] overflow-auto whitespace-pre-wrap bg-danger-bg p-4 text-danger-text">{detail}</pre>
      <button className="rounded-md bg-accent px-4 py-2.5 font-bold text-accent-text hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2" type="button" onClick={() => window.location.reload()}>Reload Elef</button>
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
