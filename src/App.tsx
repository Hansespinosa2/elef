import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import './app.css';
import { PresentationEditorSession } from './application/presentation-editor/session';
import { BrowserDocumentReader, BrowserFileSelector, BrowserReplacementConfirmation } from './infrastructure/browser/documents';
import { TauriDocumentReader, TauriFileSelector, TauriWorldFileSystem } from './infrastructure/tauri/documents';
import { WorldWorkspace } from './application/world/workspace';
import { PresentationPreview } from './components/PresentationPreview';
import { SourceModeMockups } from './components/SourceModeMockups';
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const presentationButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const presentationClickTimers = useRef<Record<string, number>>({});
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
  if (!tauri && window.location.search === '?mockups=1') return <div className={`app theme-${editorTheme}`}><SourceModeMockups /></div>;
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
  useEffect(() => {
    if (!tauri) return;
    const focusQuickOpen = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        sidebarSearchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusQuickOpen);
    return () => window.removeEventListener('keydown', focusQuickOpen);
  }, [tauri]);
  useEffect(() => {
    if (!sidebarOpen) setOpenMenuId(null);
  }, [sidebarOpen]);
  useEffect(() => {
    if (!openMenuId) return;
    menuItemRef.current?.focus();
    const dismissMenu = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenuId(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        presentationButtonRefs.current[openMenuId]?.focus();
        setOpenMenuId(null);
      }
    };
    document.addEventListener('pointerdown', dismissMenu);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissMenu);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenuId]);

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
    const presentations = worldState.presentations
      .slice()
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .filter((item) => item.title.toLowerCase().includes(sidebarQuery.trim().toLowerCase()));
    const remove = (id: string, title: string) => {
      if (window.confirm(`Delete "${title}"? This cannot be undone.`)) void world.deletePresentation(id);
    };
    const submitRename = (id: string) => {
      if (renameValue.trim()) void world.renamePresentation(id, renameValue.trim());
      setRenamingId(null);
    };
    const beginRename = (item: typeof presentations[number]) => {
      if (item.missing) return;
      setOpenMenuId(null);
      setRenamingId(item.id);
      setRenameValue(item.title);
    };
    const handlePresentationKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, item: typeof presentations[number]) => {
      if (event.key === 'F2' && !item.missing) {
        event.preventDefault();
        beginRename(item);
      } else if (event.key === 'Enter' && !item.missing) {
        event.preventDefault();
        beginRename(item);
      } else if (event.key === 'Delete' && !item.missing) {
        event.preventDefault();
        remove(item.id, item.title);
      }
    };
    const renderPresentationRow = (item: typeof presentations[number], showMenu = true) => (
      <div
        className={`presentation-item${active?.id === item.id ? ' active' : ''}`}
        key={item.id}
        onContextMenu={(event) => {
          if (item.missing || !showMenu) return;
          event.preventDefault();
          setOpenMenuId(item.id);
        }}
      >
        {renamingId === item.id ? <form className="rename-form" onSubmit={(event) => { event.preventDefault(); submitRename(item.id); }}>
          <input
            aria-label={`New name for ${item.title}`}
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null); } }}
          />
          <button type="submit">Save</button>
        </form> : <button
          className="presentation-link"
          type="button"
          ref={(element) => { presentationButtonRefs.current[item.id] = element; }}
          onClick={() => {
            if (item.missing) {
              void world.locate(item.id);
              return;
            }
            const pendingClick = presentationClickTimers.current[item.id];
            if (pendingClick) {
              window.clearTimeout(pendingClick);
              delete presentationClickTimers.current[item.id];
              beginRename(item);
              return;
            }
            presentationClickTimers.current[item.id] = window.setTimeout(() => {
              delete presentationClickTimers.current[item.id];
              void world.open(item.id);
            }, 220);
          }}
          onKeyDown={(event) => handlePresentationKeyDown(event, item)}
          aria-label={item.missing ? `Locate missing presentation ${item.title}` : `${item.title}, ${slideCount(item) ?? 0} slides`}
        >
          <span aria-hidden="true">▱</span>
          <span className="presentation-title">{item.title}{item.missing && ' (missing)'}</span>
          {!item.missing && slideCount(item) !== undefined && <small aria-hidden="true">{slideCount(item)}</small>}
        </button>}
        {showMenu && !item.missing && renamingId !== item.id && <div className="item-menu" ref={openMenuId === item.id ? menuRef : undefined}>
          {openMenuId === item.id && <div className="context-menu" role="menu" aria-label={`Actions for ${item.title}`}>
            <button ref={menuItemRef} type="button" role="menuitem" onClick={() => beginRename(item)}>Rename</button>
            <button className="destructive" type="button" role="menuitem" onClick={() => { setOpenMenuId(null); remove(item.id, item.title); }}>Delete</button>
          </div>}
        </div>}
      </div>
    );
    const slideCount = (item: typeof presentations[number]) => {
      try { return world.presentation(item.id)?.slides.length; } catch { return undefined; }
    };
    const sidebar = sidebarOpen && <aside className="world-sidebar">
      <div className="sidebar-header"><strong>Elef World</strong><button className="icon-button" type="button" aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)}>‹</button></div>
      <label className="sidebar-search" role="search"><span aria-hidden="true">⌕</span><input ref={sidebarSearchRef} aria-label="Quick open presentations" placeholder="Quick open" value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} /><kbd>⌘K</kbd></label>
      <button className="new-presentation" type="button" onClick={() => void world.createDraft()}>＋ New presentation</button>
      <div className="sidebar-section-title"><span>Current presentation</span><span className="sidebar-count">{active ? 1 : 0}</span></div>
      <nav className="current-presentation" aria-label="Current presentation">{active && renderPresentationRow(active, false)}</nav>
      <div className="sidebar-section-title"><span>All files</span><span className="sidebar-count">{presentations.length}</span></div>
      <nav aria-label="All presentations">{presentations.map((item) => renderPresentationRow(item))}</nav>
      <footer className="sidebar-footer"><span>Elef World</span><span>Ctrl/Cmd+B Sidebar</span></footer>
    </aside>;
    if (import.meta.env.DEV && active) console.debug('[elef] workspace render', { action: 'presentation', phase: 'parse', presentationId: active.id });
    const presentation = active ? world.presentation(active.id) : null;
    const presentationTheme = presentation?.presentationTheme ?? 'match';
    const worldError = worldState.error || active?.error || (active && !presentation ? 'Unable to render this presentation. The current source was retained.' : null);
    return <div className={`app world-app theme-${editorTheme}`}><button className={`sidebar-toggle${sidebarOpen ? ' hidden' : ''}`} type="button" aria-label="Expand sidebar" onClick={() => setSidebarOpen(true)}>›</button>{sidebar}{worldError && <div className="error" role="alert">{worldError}</div>}{active && presentation ? <main className="world-main"><header className="document-toolbar"><span className="document-name">{active.title}</span><ThemeMenu editorPreference={editorPreference} presentationTheme={presentationTheme} onEditorChange={setEditorPreference} onPresentationChange={(theme) => world.updatePresentationTheme(active.id, theme)} /></header><div className="workspace"><PresentationPreview presentation={presentation} theme={resolvePresentationTheme(presentationTheme, editorTheme)} source={world.editorSource(active.id)} onSourceChange={(source) => world.updateSource(active.id, source)} /></div></main> : <main className="world-main empty-world"><h1>Your presentations</h1><p>{active ? 'Fix the Markdown and try again.' : 'Select a presentation from the sidebar or create a new one.'}</p></main>}</div>;
  }
  return (
    <div className={`app theme-${editorTheme}`}>
      <header className="toolbar">
        <div><strong>Elef</strong><span className="subtitle">Markdown presentation</span>{state.sourceName && <span className="document-name">{state.sourceName}</span>}</div>
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
        <PresentationPreview
          presentation={state.presentation}
          theme={resolvePresentationTheme(state.presentation.presentationTheme, editorTheme)}
          source={state.source}
          onSourceChange={(source) => session.updateSource(source)}
        />
      </div> : !state.error && (
        <section className="welcome"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
