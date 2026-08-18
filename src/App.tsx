import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import './app.css';
import { PresentationEditorSession } from './application/presentation-editor/session';
import { BrowserDocumentReader, BrowserFileSelector, BrowserReplacementConfirmation } from './infrastructure/browser/documents';
import { TauriDocumentReader, TauriFileSelector, TauriWorldFileSystem } from './infrastructure/tauri/documents';
import { WorldWorkspace } from './application/world/workspace';
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
  const tauri = isTauri();
  const [world] = useState(() => new WorldWorkspace(new TauriWorldFileSystem()));
  const worldState = useSyncExternalStore(world.subscribe.bind(world), world.getState.bind(world), world.getState.bind(world));
  useEffect(() => { if (tauri && worldState.root) void world.rescan(); }, [tauri]);

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

  if (tauri) {
    const active = worldState.activeId ? worldState.presentations.find((item) => item.id === worldState.activeId) : null;
    if (!worldState.root) return <div className="app"><section className="setup"><h1>Create your Elef World</h1><p>Choose or create a dedicated folder where Elef will keep your presentations.</p><button type="button" onClick={() => void world.setup()}>Create Elef World folder</button></section></div>;
    if (!active) return <div className="app"><header className="toolbar"><div><strong>Elef World</strong><span className="subtitle">{worldState.root}</span></div><button type="button" onClick={() => void world.createDraft()}>New Presentation</button></header>{worldState.error && <div className="error" role="alert">{worldState.error}</div>}<main className="dashboard"><aside className="sidebar"><h2>Recent</h2>{worldState.presentations.map((item) => <button className="recent-item" type="button" key={item.id} onClick={() => item.missing ? void world.locate(item.id) : world.open(item.id)}>{item.title}{item.missing && ' (missing)'}</button>)}</aside><section className="resume"><h1>Your presentations</h1>{worldState.presentations.length ? worldState.presentations.slice().sort((a, b) => b.lastOpened - a.lastOpened).map((item) => <article className="resume-card" key={item.id}><h2>{item.title}</h2>{item.missing ? <p>Presentation not found. <button type="button" onClick={() => void world.locate(item.id)}>Locate</button> <button type="button" onClick={() => world.removeMissing(item.id)}>Remove</button></p> : <><PresentationPreview presentation={world.presentation(item.id)!} /><button type="button" onClick={() => world.open(item.id)}>Open</button></>}</article>) : <p>No presentations yet.</p>}</section></main></div>;
    return <div className="app"><header className="toolbar"><div><strong>Elef World</strong><span className="document-name">{active.title}</span></div><button type="button" onClick={() => world.close()}>Dashboard</button></header>{worldState.error && <div className="error" role="alert">{worldState.error}</div>}<div className="workspace"><MarkdownEditor source={world.editorSource(active.id)} onChange={(source) => world.updateSource(active.id, source)} /><PresentationPreview presentation={world.presentation(active.id)!} /></div></div>;
  }
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
