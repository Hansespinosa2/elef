import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import './app.css';
import { PresentationEditorSession } from './application/presentation-editor/session';
import { BrowserDocumentReader, BrowserFileSelector, BrowserReplacementConfirmation } from './infrastructure/browser/documents';
import { TauriDocumentReader, TauriFileSelector, TauriWorldFileSystem } from './infrastructure/tauri/documents';
import { WorldWorkspace } from './application/world/workspace';
import { confirmPresentationDeletion } from './application/world/delete-confirmation';
import { PresentationPreview } from './components/PresentationPreview';
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
      className={`theme-choice grid min-w-0 justify-items-center gap-1.5 rounded-[9px] border border-transparent bg-transparent px-1.5 py-2.5 text-xs font-semibold text-text${selected ? ' selected border-focus bg-panel-muted text-text-strong shadow-[inset_0_0_0_1px_var(--focus)]' : ' hover:bg-panel-muted'}${disabled ? ' cursor-not-allowed' : ''}`}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className={`theme-swatch h-[1.35rem] w-8 rounded-[5px] border border-border-strong bg-panel-bg shadow-[inset_0_0_0_3px_var(--app-bg)] theme-swatch-${value}`} aria-hidden="true" />
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
    <details className="theme-menu relative flex-none">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border bg-panel-bg px-3.5 py-2.5 font-bold text-text shadow-[0_2px_8px_var(--shadow)] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"><span className="theme-menu-icon text-[1.1rem] leading-none text-accent" aria-hidden="true">◐</span> Theme</summary>
      <div className="theme-menu-panel absolute right-0 top-[calc(100%+.55rem)] z-[5] grid min-w-72 gap-4 rounded-[14px] border border-border bg-panel-bg p-4 shadow-[0_18px_42px_var(--shadow)]">
        <fieldset className="theme-group m-0 min-w-0 border-0 p-0" role="radiogroup" aria-label="Editor theme">
          <legend className="mb-1.5 p-0 text-[.72rem] font-bold uppercase tracking-[.08em] text-text-muted">Editor</legend>
          <div className="theme-choices grid grid-cols-3 gap-1.5">
            <ThemeChoice label="System" value="system" selected={editorPreference === 'system'} onSelect={() => onEditorChange('system')} />
            <ThemeChoice label="Light" value="light" selected={editorPreference === 'light'} onSelect={() => onEditorChange('light')} />
            <ThemeChoice label="Dark" value="dark" selected={editorPreference === 'dark'} onSelect={() => onEditorChange('dark')} />
          </div>
        </fieldset>
        <fieldset className="theme-group m-0 min-w-0 border-0 p-0 disabled:opacity-50" role="radiogroup" aria-label="Presentation theme" disabled={presentationDisabled}>
          <legend className="mb-1.5 p-0 text-[.72rem] font-bold uppercase tracking-[.08em] text-text-muted">Presentation</legend>
          <div className="theme-choices grid grid-cols-3 gap-1.5">
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
    if (!worldState.root) return <div className={`app theme-${editorTheme} min-h-screen bg-app-bg p-5 text-text max-[800px]:p-3`}><section className="setup grid min-h-[80vh] place-content-center text-center"><h1 className="text-text-strong">Create your Elef World</h1><p>Choose or create a dedicated folder where Elef will keep your presentations.</p><button className="rounded-md bg-accent px-4 py-2.5 font-bold text-accent-text hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2" type="button" onClick={() => void world.setup()}>Create Elef World folder</button></section></div>;
    const presentations = worldState.presentations
      .slice()
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .filter((item) => item.title.toLowerCase().includes(sidebarQuery.trim().toLowerCase()));
    const remove = async (id: string, title: string) => {
      if (await confirmPresentationDeletion(tauri, `Delete "${title}"? This cannot be undone.`)) {
        await world.deletePresentation(id);
      }
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
        void remove(item.id, item.title);
      }
    };
    const renderPresentationRow = (item: typeof presentations[number], showMenu = true) => (
      <div
        className={`presentation-item relative my-0.5 flex items-center gap-1 rounded-[5px]${active?.id === item.id ? ' active bg-panel-muted' : ''}`}
        key={item.id}
        onContextMenu={(event) => {
          if (item.missing || !showMenu) return;
          event.preventDefault();
          setOpenMenuId(item.id);
        }}
      >
        {renamingId === item.id ? <form className="rename-form flex w-full gap-1 p-1" onSubmit={(event) => { event.preventDefault(); submitRename(item.id); }}>
          <input
            aria-label={`New name for ${item.title}`}
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded border border-focus bg-input-bg p-1.5 text-text outline-0"
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null); } }}
          />
          <button className="rounded bg-accent px-2 py-1.5 text-xs font-bold text-accent-text" type="submit">Save</button>
        </form> : <button
          className="presentation-link flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap bg-transparent px-2.5 py-2 text-left text-text hover:bg-panel-bg focus-visible:relative focus-visible:z-[1]"
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
          <span className="presentation-title min-w-0 overflow-hidden text-ellipsis">{item.title}{item.missing && ' (missing)'}</span>
          {!item.missing && slideCount(item) !== undefined && <small className="ml-auto text-[.7rem] text-text-muted" aria-hidden="true">{slideCount(item)}</small>}
        </button>}
        {showMenu && !item.missing && renamingId !== item.id && <div className="item-menu" ref={openMenuId === item.id ? menuRef : undefined}>
          {openMenuId === item.id && <div className="context-menu absolute bottom-[calc(100%+.2rem)] right-1 z-10 grid min-w-32 rounded border border-border bg-panel-bg p-1 shadow-[0_8px_20px_var(--shadow)]" role="menu" aria-label={`Actions for ${item.title}`}>
            <button className="px-2 py-1.5 text-left text-[.8rem] font-medium text-text hover:bg-panel-muted focus-visible:bg-panel-muted" ref={menuItemRef} type="button" role="menuitem" onClick={() => beginRename(item)}>Rename</button>
             <button className="destructive px-2 py-1.5 text-left text-[.8rem] font-medium text-danger hover:bg-panel-muted focus-visible:bg-panel-muted" type="button" role="menuitem" onClick={() => { setOpenMenuId(null); void remove(item.id, item.title); }}>Delete</button>
          </div>}
        </div>}
      </div>
    );
    const slideCount = (item: typeof presentations[number]) => {
      try { return world.presentation(item.id)?.slides.length; } catch { return undefined; }
    };
    const sidebar = sidebarOpen && <aside className="world-sidebar sticky top-0 flex h-screen w-68 flex-none flex-col overflow-y-auto border-r border-border bg-chrome-bg p-4 pb-3 max-[800px]:w-56">
      <div className="sidebar-header mb-4 flex items-center justify-between text-accent"><strong>Elef World</strong><button className="icon-button bg-transparent px-2.5 py-1 text-[1.4rem] leading-none text-text hover:bg-panel-muted" type="button" aria-label="Collapse sidebar" onClick={() => setSidebarOpen(false)}>‹</button></div>
      <label className="sidebar-search mb-3 flex items-center gap-2 rounded-[5px] border border-border bg-panel-bg px-2.5 py-2 text-xs text-text-muted focus-within:border-focus focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--focus)_18%,transparent)]" role="search"><span aria-hidden="true">⌕</span><input className="min-w-0 flex-1 border-0 bg-transparent text-text outline-0 placeholder:text-text-muted" ref={sidebarSearchRef} aria-label="Quick open presentations" placeholder="Quick open" value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} /><kbd className="ml-auto rounded-[3px] border border-border bg-panel-muted px-1 py-px text-[.7rem] text-text-muted">⌘K</kbd></label>
      <button className="new-presentation mb-4 w-full rounded-md bg-accent px-4 py-2.5 text-left font-bold text-accent-text hover:bg-accent-hover" type="button" onClick={() => void world.createDraft()}>＋ New presentation</button>
      <div className="sidebar-section-title mx-1 mb-1 flex items-center justify-between text-[.7rem] font-extrabold uppercase tracking-[.08em] text-text-muted"><span>Current presentation</span><span className="sidebar-count text-xs tracking-normal text-accent">{active ? 1 : 0}</span></div>
      <nav className="current-presentation" aria-label="Current presentation">{active && renderPresentationRow(active, false)}</nav>
      <div className="sidebar-section-title mx-1 mb-1 mt-3 flex items-center justify-between text-[.7rem] font-extrabold uppercase tracking-[.08em] text-text-muted"><span>All files</span><span className="sidebar-count text-xs tracking-normal text-accent">{presentations.length}</span></div>
      <nav aria-label="All presentations">{presentations.map((item) => renderPresentationRow(item))}</nav>
      <footer className="sidebar-footer mt-auto flex justify-between gap-2 border-t border-border px-1 pb-1 pt-4 text-[.7rem] text-text-muted"><span>Elef World</span><span>Ctrl/Cmd+B Sidebar</span></footer>
    </aside>;
    if (import.meta.env.DEV && active) console.debug('[elef] workspace render', { action: 'presentation', phase: 'parse', presentationId: active.id });
    const presentation = active ? world.presentation(active.id) : null;
    const presentationTheme = presentation?.presentationTheme ?? 'match';
    const worldError = worldState.error || active?.error || (active && !presentation ? 'Unable to render this presentation. The current source was retained.' : null);
    return <div className={`app world-app theme-${editorTheme} flex h-screen min-h-screen overflow-hidden bg-app-bg p-0`}><button className={`sidebar-toggle fixed left-2 top-4 z-[1] bg-transparent px-2.5 py-1 text-[1.4rem] leading-none text-text hover:bg-panel-muted${sidebarOpen ? ' hidden' : ''}`} type="button" aria-label="Expand sidebar" onClick={() => setSidebarOpen(true)}>›</button>{sidebar}{worldError && <div className="error mx-auto mb-6 max-w-[1100px] rounded-md border border-danger bg-danger-bg p-4 text-danger-text" role="alert">{worldError}</div>}{active && presentation ? <main className="world-main min-w-0 h-screen flex-1 overflow-y-auto p-5 max-[800px]:p-4"><header className="document-toolbar mx-auto mb-6 flex max-w-[1400px] items-center justify-between gap-4"><span className="document-name ml-3 text-[.9rem] text-text">{active.title}</span><ThemeMenu editorPreference={editorPreference} presentationTheme={presentationTheme} onEditorChange={setEditorPreference} onPresentationChange={(theme) => world.updatePresentationTheme(active.id, theme)} /></header><div className="workspace mx-auto flex max-w-[1100px] flex-col gap-6"><PresentationPreview presentation={presentation} theme={resolvePresentationTheme(presentationTheme, editorTheme)} source={world.editorSource(active.id)} onSourceChange={(source) => world.updateSource(active.id, source)} /></div></main> : <main className="world-main empty-world grid h-screen min-w-0 flex-1 place-content-center overflow-y-auto p-5 text-center text-text-muted max-[800px]:p-4"><h1 className="text-text-strong">Your presentations</h1><p>{active ? 'Fix the Markdown and try again.' : 'Select a presentation from the sidebar or create a new one.'}</p></main>}</div>;
  }
  return (
  <div className={`app theme-${editorTheme} min-h-screen p-5 text-text max-[800px]:p-3`}>
    <header className="toolbar mx-auto mb-8 flex max-w-[1400px] items-center gap-4 max-[800px]:flex-wrap max-[800px]:items-stretch">
        <div className="mr-auto max-[800px]:w-full max-[800px]:mr-0"><strong className="text-xl text-accent">Elef</strong><span className="subtitle ml-3 text-text-muted">Markdown presentation</span>{state.sourceName && <span className="document-name ml-3 text-[.9rem] text-text">{state.sourceName}</span>}</div>
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
      {state.error && <div className="error mx-auto mb-6 max-w-[1100px] rounded-md border border-danger bg-danger-bg p-4 text-danger-text" role="alert"><strong>Could not open file.</strong> {state.error}</div>}
      {state.presentation ? <div className="workspace mx-auto flex max-w-[1100px] flex-col gap-6">
        <PresentationPreview
          presentation={state.presentation}
          theme={resolvePresentationTheme(state.presentation.presentationTheme, editorTheme)}
          source={state.source}
          onSourceChange={(source) => session.updateSource(source)}
        />
      </div> : !state.error && (
        <section className="welcome grid min-h-[60vh] place-content-center text-center"><h1>Open a Markdown file</h1><p>Use <code>---</code> on its own line to create a new slide.</p></section>
      )}
    </div>
  );
}

export default App;
