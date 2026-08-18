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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
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
    const presentations = worldState.presentations.slice().sort((a, b) => b.lastOpened - a.lastOpened);
    const remove = (id: string, title: string) => {
      if (window.confirm(`Delete "${title}"? This cannot be undone.`)) void world.deletePresentation(id);
    };
    const submitRename = (id: string) => {
      if (renameValue.trim()) void world.renamePresentation(id, renameValue.trim());
      setRenamingId(null);
    };
    const sidebar = sidebarOpen && <aside className="world-sidebar">
      <div className="sidebar-header"><strong>Elef World</strong><button className="icon-button" type="button" aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)}>‹</button></div>
      <button className="new-presentation" type="button" onClick={() => void world.createDraft()}>＋ New presentation</button>
      <nav aria-label="Presentations">{presentations.map((item) => <div className={`presentation-item${active?.id === item.id ? ' active' : ''}`} key={item.id}>
        {renamingId === item.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); submitRename(item.id); }}><input aria-label={`New name for ${item.title}`} autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }} /><button type="submit">Save</button></form> : <><button className="presentation-link" type="button" onClick={() => item.missing ? void world.locate(item.id) : world.open(item.id)}>{item.title}{item.missing && ' (missing)'}</button>
        {!item.missing && <span className="item-actions"><button type="button" aria-label={`Rename ${item.title}`} onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }}>Rename</button><button type="button" aria-label={`Delete ${item.title}`} onClick={() => remove(item.id, item.title)}>Delete</button></span>}</>}
      </div>)}</nav>
    </aside>;
    return <div className="app world-app"><button className={`sidebar-toggle${sidebarOpen ? ' hidden' : ''}`} type="button" aria-label="Expand sidebar" onClick={() => setSidebarOpen(true)}>›</button>{sidebar}{worldState.error && <div className="error" role="alert">{worldState.error}</div>}{active ? <main className="world-main"><header className="document-toolbar"><span className="document-name">{active.title}</span></header><div className="workspace"><MarkdownEditor source={world.editorSource(active.id)} onChange={(source) => world.updateSource(active.id, source)} /><PresentationPreview presentation={world.presentation(active.id)!} /></div></main> : <main className="world-main empty-world"><h1>Your presentations</h1><p>Select a presentation from the sidebar or create a new one.</p></main>}</div>;
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
