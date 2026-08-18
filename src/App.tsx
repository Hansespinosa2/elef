import { useRef, useState, useSyncExternalStore } from 'react';
import './app.css';
import { PresentationEditorSession } from './application/presentation-editor/session';
import { BrowserDocumentReader, BrowserFileSelector, BrowserReplacementConfirmation } from './infrastructure/browser/documents';
import { TauriDocumentReader, TauriFileSelector } from './infrastructure/tauri/documents';
import { PresentationPreview } from './components/PresentationPreview';
import { MarkdownEditor } from './components/MarkdownEditor';

function App() {
  const [session] = useState(() => new PresentationEditorSession());
  const inputRef = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(
    session.subscribe.bind(session),
    session.getState.bind(session),
    session.getState.bind(session),
  );
  const [confirmation] = useState(() => new BrowserReplacementConfirmation());
  const tauri = Boolean(window.__TAURI__);

  const openFile = () => {
    const selector = tauri
      ? new TauriFileSelector()
      : inputRef.current
        ? new BrowserFileSelector(inputRef.current)
        : null;
    if (!selector) return;
    const reader = tauri ? new TauriDocumentReader() : new BrowserDocumentReader();
    void session.open(selector, reader, confirmation);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div><strong>Elef</strong><span className="subtitle">Markdown presentation</span>{state.sourceName && <span className="document-name">{state.sourceName}{state.source !== state.baseline && ' *'}</span>}</div>
        <button type="button" onClick={() => session.newDocument(confirmation)}>New Markdown</button>
        <button type="button" onClick={openFile}>Open Markdown</button>
        <input ref={inputRef} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" />
      </header>
      {state.error && <div className="error" role="alert"><strong>Could not open file.</strong> {state.error}</div>}
      {state.presentation ? <div className="workspace">
        <MarkdownEditor source={state.source} onChange={(source) => session.updateSource(source)} />
        <PresentationPreview presentation={state.presentation} />
      </div> : !state.error && (
        <section className="welcome"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
