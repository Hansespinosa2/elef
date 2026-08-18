import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import './app.css';
import { PresentationEditorSession } from './application/presentation-editor/session';
import { BrowserDocumentReader, BrowserFileSelector, BrowserReplacementConfirmation } from './infrastructure/browser/documents';
import { TauriDocumentReader, TauriFileSelector, TauriWorldFileSystem } from './infrastructure/tauri/documents';
import { WorldWorkspace } from './application/world/workspace';
import { PresentationPreview } from './components/PresentationPreview';
import { MarkdownEditor } from './components/MarkdownEditor';
import {
  normalizeEditorThemePreference,
  resolveEditorTheme,
  resolvePresentationTheme,
} from './domain/presentation';
import type {
  EditorThemePreference,
  PresentationTheme,
  ThemeMode,
} from './domain/presentation';

const editorThemeKey = 'elef.editor-theme';

interface ThemeMenuProps {
  editorPreference: EditorThemePreference;
  presentationTheme: PresentationTheme;
  presentationDisabled?: boolean;
  onEditorChange: (theme: EditorThemePreference) => void;
  onPresentationChange: (theme: PresentationTheme) => void;
}

interface ThemeChoiceProps {
  label: string;
  value: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function ThemeChoice({ label, value, selected, disabled, onSelect }: ThemeChoiceProps) {
  return (
    <button
      className={`theme-choice${selected ? ' selected' : ''}`}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={`theme-swatch theme-swatch-${value}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function ThemeMenu({
  editorPreference,
  presentationTheme,
  presentationDisabled,
  onEditorChange,
  onPresentationChange,
}: ThemeMenuProps) {
  return (
    <details className="theme-menu">
      <summary><span className="theme-menu-icon" aria-hidden="true">◐</span> Theme</summary>
      <div className="theme-menu-panel">
        <fieldset className="theme-group" role="radiogroup" aria-label="Editor theme">
          <legend>Editor</legend>
          <div className="theme-choices">
            <ThemeChoice label="System" value="system" selected={editorPreference === 'system'} onSelect={() => onEditorChange('system')} />
            <ThemeChoice label="Light" value="light" selected={editorPreference === 'light'} onSelect={() => onEditorChange('light')} />
            <ThemeChoice label="Dark" value="dark" selected={editorPreference === 'dark'} onSelect={() => onEditorChange('dark')} />
          </div>
        </fieldset>
        <fieldset className="theme-group" role="radiogroup" aria-label="Presentation theme" disabled={presentationDisabled}>
          <legend>Presentation</legend>
          <div className="theme-choices">
            <ThemeChoice label="Match editor" value="match" selected={presentationTheme === 'match'} disabled={presentationDisabled} onSelect={() => onPresentationChange('match')} />
            <ThemeChoice label="Light" value="light" selected={presentationTheme === 'light'} disabled={presentationDisabled} onSelect={() => onPresentationChange('light')} />
            <ThemeChoice label="Dark" value="dark" selected={presentationTheme === 'dark'} disabled={presentationDisabled} onSelect={() => onPresentationChange('dark')} />
          </div>
        </fieldset>
      </div>
    </details>
  );
}

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
  const [editorPreference, setEditorPreferenceState] = useState<EditorThemePreference>(() => {
    try {
      return normalizeEditorThemePreference(localStorage.getItem(editorThemeKey));
    } catch {
      return 'system';
    }
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  ));
  const editorTheme: ThemeMode = resolveEditorTheme(editorPreference, systemPrefersDark);
  const tauri = isTauri();
  const [world] = useState(() => new WorldWorkspace(new TauriWorldFileSystem()));
  const worldState = useSyncExternalStore(world.subscribe.bind(world), world.getState.bind(world), world.getState.bind(world));
  const setEditorPreference = (preference: EditorThemePreference) => {
    setEditorPreferenceState(preference);
    try {
      if (preference === 'system') localStorage.removeItem(editorThemeKey);
      else localStorage.setItem(editorThemeKey, preference);
    } catch {
      // The active choice still applies when storage is unavailable.
    }
  };
  useEffect(() => {
    document.documentElement.dataset.editorTheme = editorTheme;
  }, [editorTheme]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemPrefersDark(media.matches);
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);
  useEffect(() => { if (tauri && worldState.root) void world.rescan(); }, [tauri]);
  useEffect(() => {
    if (!tauri) return;
    const toggleSidebar = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', toggleSidebar);
    return () => window.removeEventListener('keydown', toggleSidebar);
  }, [tauri]);

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
    if (!worldState.root) return <div className={`app theme-${editorTheme}`}><section className="setup"><h1>Create your Elef World</h1><p>Choose or create a dedicated folder where Elef will keep your presentations.</p><button type="button" onClick={() => void world.setup()}>Create Elef World folder</button></section></div>;
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
    const presentation = active ? world.presentation(active.id) : null;
    const presentationTheme = presentation?.presentationTheme ?? 'match';
    return <div className={`app world-app theme-${editorTheme}`}><button className={`sidebar-toggle${sidebarOpen ? ' hidden' : ''}`} type="button" aria-label="Expand sidebar" onClick={() => setSidebarOpen(true)}>›</button>{sidebar}{worldState.error && <div className="error" role="alert">{worldState.error}</div>}{active && presentation ? <main className="world-main"><header className="document-toolbar"><span className="document-name">{active.title}</span><ThemeMenu editorPreference={editorPreference} presentationTheme={presentationTheme} onEditorChange={setEditorPreference} onPresentationChange={(theme) => world.updatePresentationTheme(active.id, theme)} /></header><div className="workspace"><MarkdownEditor source={world.editorSource(active.id)} onChange={(source) => world.updateSource(active.id, source)} /><PresentationPreview presentation={presentation} theme={resolvePresentationTheme(presentationTheme, editorTheme)} /></div></main> : <main className="world-main empty-world"><h1>Your presentations</h1><p>Select a presentation from the sidebar or create a new one.</p></main>}</div>;
  }
  return (
    <div className={`app theme-${editorTheme}`}>
      <header className="toolbar">
        <div><strong>Elef</strong><span className="subtitle">Markdown presentation</span>{state.sourceName && <span className="document-name">{state.sourceName}{state.source !== state.baseline && ' *'}</span>}</div>
        <ThemeMenu
          editorPreference={editorPreference}
          presentationTheme={state.presentation?.presentationTheme ?? 'match'}
          presentationDisabled={!state.presentation}
          onEditorChange={setEditorPreference}
          onPresentationChange={(theme) => session.updatePresentationTheme(theme)}
        />
        <button type="button" onClick={() => session.newDocument(confirmation)}>New Markdown</button>
        <button type="button" onClick={openFile}>Open Markdown</button>
        <input ref={inputRef} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" />
      </header>
      {state.error && <div className="error" role="alert"><strong>Could not open file.</strong> {state.error}</div>}
      {state.presentation ? <div className="workspace">
        <MarkdownEditor source={state.source} onChange={(source) => session.updateSource(source)} />
        <PresentationPreview presentation={state.presentation} theme={resolvePresentationTheme(state.presentation.presentationTheme, editorTheme)} />
      </div> : !state.error && (
        <section className="welcome"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
