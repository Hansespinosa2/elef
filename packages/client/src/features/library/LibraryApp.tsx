import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, JSX, MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";
import type { ElefMountOptions, LibraryFilter, NoticeTone } from "../../application/types.js";
import { parseLibraryRoute } from "../../application/router.js";
import { filterWorks, sameWorks } from "./filtering.js";
import { nextDefaultWorkTitle } from "./default_titles.js";
import { LibraryCard, StagePreview, cardDomId } from "./LibraryCard.js";
import type { PaletteMode } from "../../application/types.js";
import { CommandPalette } from "./CommandPalette.js";
import { buildNewWorkSource } from "@elef/work-model/style-vocab";
import { readLibraryVimNav } from "../../ui/libraryVimNav.js";

export interface LibraryControl {
  reload(): Promise<void>;
  notify(message: string | null, tone?: NoticeTone): void;
  setFilter(filter: LibraryFilter): void;
  openPalette(mode: PaletteMode): void;
}

export interface LibraryAppProps {
  readonly host: ElefHost;
  readonly initialFilter: LibraryFilter;
  readonly options: ElefMountOptions;
  readonly registerControl?: (control: LibraryControl) => void;
}

export const LIBRARY_RENDER_BATCH_SIZE = 48;
export const CREATE_WORK_EVENT = "elef:create-work";
// Event detail contract: { kind: WorkKind; direct?: boolean }. Without
// `direct` (the shared empty-state button on both hosts) the client opens
// its name-first dialog; with `direct: true` (the desktop menu, palette,
// and native menu — parity with the web header navigating straight to the
// edit shell) the client creates immediately with the shared unique default
// title and opens the new work.

const FILTER_DESCRIPTIONS: Record<LibraryFilter, string> = {
  all: "One home for your documents, presentations, and source.",
  documents: "Long-form Markdown, gathered in one calm place.",
  presentations: "Slide-based Markdown, ready to shape into a story.",
};

const KIND_LABELS: Record<LibraryFilter, string> = {
  all: "work",
  documents: "document",
  presentations: "presentation",
};

function localTarget(value: string, label: string): string {
  if (!/^(?:\/(?!\/)|#)/.test(value)) throw new TypeError(`${label} must be a local target`);
  return value;
}

export function LibraryApp({ host, initialFilter, options, registerControl }: LibraryAppProps): JSX.Element {
  const [works, setWorks] = useState<readonly WorkSummary[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("info");
  const [visibleCount, setVisibleCount] = useState(LIBRARY_RENDER_BATCH_SIZE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<WorkKind>("presentation");
  const [dialogName, setDialogName] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("commands");
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [hoveredWorkId, setHoveredWorkId] = useState<string | null>(null);
  const [keyboardPreviewId, setKeyboardPreviewId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // Wherever ⌘K was pressed: restoring it on close returns the caret to the
  // editor when editing, the search box when browsing.
  const invokeRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  // The create listener below registers once, so it reads the work list for
  // default-title uniqueness through this mirror (same idiom as filterRef).
  const worksRef = useRef(works);
  worksRef.current = works;
  const directCreatePendingRef = useRef(false);

  const showNotice = useCallback((message: string | null, tone: NoticeTone = "info") => {
    setNotice(message ?? "");
    setNoticeTone(tone);
  }, []);

  const reload = useCallback(
    async (notice: string | null = null, tone: NoticeTone = "info"): Promise<void> => {
      try {
        const spaces = await host.library.listWorkspaces();
        const loaded: WorkSummary[] = [];
        for (const space of spaces) {
          loaded.push(...(await host.library.listWorks(space.id)));
        }
        // Bail out on identical data: returning the current array skips the
        // commit, so a no-change refresh costs the fetch but no render.
        setWorks((current) => (sameWorks(current, loaded) ? current : loaded));
        setReady(true);
        showNotice(notice, tone);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), "error");
      }
    },
    [host, showNotice],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // Prefetch the deferred preview renderer on the first post-mount idle
  // turn: the first card preview would otherwise parse ~600KB of KaTeX,
  // highlight.js and markdown-it beside its snapshot, and a work open that
  // follows the list would share that parse. Best effort; a failed prefetch
  // is retried by the preview load itself and degrades as usual.
  useEffect(() => {
    let cancelled = false;
    const idle = globalThis.requestIdleCallback;
    const schedule =
      typeof idle === "function"
        ? (callback: () => void): void => {
            idle(() => callback(), { timeout: 2000 });
          }
        : (callback: () => void): void => {
            setTimeout(callback, 0);
          };
    schedule(() => {
      if (!cancelled) void import("@elef/client/preview-core").catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    registerControl?.({
      reload: () => reload(),
      notify: (message, tone) => showNotice(message, tone),
      setFilter: (next) => {
        setFilter(next);
        setVisibleCount(LIBRARY_RENDER_BATCH_SIZE);
      },
      openPalette: (mode) => {
        // Linkedom (client tests) leaves activeElement undefined; real DOM
        // always yields an Element or null. Capture the invoker only when
        // focus sits outside the palette: a second ⌘K while open
        // (double-press, key auto-repeat — the palette autofocuses its own
        // input on open) must not re-capture the palette input, or close
        // would restore focus into the unmounted surface and drop the caret
        // to the body. Null (no focused element) keeps the previous invoker
        // for the same reason.
        if (typeof document !== "undefined") {
          const active = (document.activeElement as HTMLElement | null | undefined) ?? null;
          if (active !== null && active.closest?.(".command-palette") === null) {
            invokeRef.current = active;
          }
        } else {
          invokeRef.current = null;
        }
        setPaletteMode(mode);
        setPaletteOpen(true);
      },
    });
  }, [registerControl, reload, showNotice]);

  useEffect(() => {
    function onRouteChange(): void {
      const href = globalThis.location?.href;
      if (typeof href !== "string") return;
      const route = parseLibraryRoute(href);
      if (route !== null && route.filter !== filterRef.current) setFilter(route.filter);
    }
    globalThis.window?.addEventListener?.("popstate", onRouteChange);
    globalThis.window?.addEventListener?.("hashchange", onRouteChange);
    return () => {
      globalThis.window?.removeEventListener?.("popstate", onRouteChange);
      globalThis.window?.removeEventListener?.("hashchange", onRouteChange);
    };
  }, []);

  useEffect(() => {
    const graph = rootRef.current?.querySelector("#document-graph-view");
    if (graph !== null && graph !== undefined && graph.childElementCount > 0) {
      (graph as unknown as { hidden: boolean }).hidden = filter !== "documents";
    }
  }, [filter]);

  const createDirect = useCallback(
    async (kind: WorkKind): Promise<void> => {
      // Double-submit guard: two rapid menu activations would otherwise
      // compute the same default title and the second create fails on the
      // host's uniqueness check. Cross-window races still land on the
      // notice path below, like any other failed create.
      if (directCreatePendingRef.current) return;
      directCreatePendingRef.current = true;
      try {
        const name = nextDefaultWorkTitle(
          kind,
          worksRef.current.map((work) => work.title),
        );
        const spaces = await host.library.listWorkspaces();
        const space = spaces[0];
        if (space === undefined) return;
        const created = await host.library.createWork({
          workspaceId: space.id,
          title: name,
          kind,
          // New works seed the default front matter, exactly like the
          // name-first dialog below; without it direct-created works would
          // skip the default seed.
          text: buildNewWorkSource({ kind, title: name }),
        });
        options.onLibraryEvent?.({ type: "created", work: created });
        await reload();
        options.navigate?.({ workId: created.id, kind: created.kind });
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), "error");
      } finally {
        directCreatePendingRef.current = false;
      }
    },
    [host, options, reload, showNotice],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    function onCreate(event: Event): void {
      const detail = (event as CustomEvent).detail ?? {};
      const kind = detail.kind === "document" ? "document" : "presentation";
      if (detail.direct === true) {
        void createDirect(kind);
        return;
      }
      setDialogKind(kind);
      setDialogName("");
      setDialogOpen(true);
    }
    root.addEventListener(CREATE_WORK_EVENT, onCreate as EventListener);
    return () => root.removeEventListener(CREATE_WORK_EVENT, onCreate as EventListener);
  }, [createDirect]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (dialogOpen) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      (dialog.querySelector("#new-work-name") as HTMLElement | null)?.focus?.();
    } else if (typeof dialog.close === "function") {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }, [dialogOpen]);

  const filtered = filterWorks(works, filter);
  const visible = filterWorks(works, filter, query);
  const shown = visible.slice(0, visibleCount);
  const hasMore = visible.length > shown.length;
  const activeWork =
    shown.find((work) => work.id === hoveredWorkId) ??
    shown.find((work) => work.id === selectedWorkId) ??
    shown[0] ??
    null;
  const popoverWork =
    shown.find((work) => work.id === (hoveredWorkId ?? keyboardPreviewId)) ?? null;
  const activeSelectedId = activeWork?.id ?? null;

  const moveSelection = useCallback(
    (delta: number) => {
      if (shown.length === 0) return;
      const currentIndex = shown.findIndex((work) => work.id === (selectedWorkId ?? shown[0]?.id));
      const baseIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = (baseIndex + delta + shown.length) % shown.length;
      const nextWork = shown[nextIndex];
      if (nextWork === undefined) return;
      setHoveredWorkId(null);
      setSelectedWorkId(nextWork.id);
      setKeyboardPreviewId(nextWork.id);
      const cardEl = rootRef.current?.querySelector(`#${cardDomId(nextWork)}`) as
        | (HTMLElement & { scrollIntoView?: (opts: { block: string }) => void })
        | null
        | undefined;
      cardEl?.scrollIntoView?.({ block: "nearest" });
      (cardEl?.querySelector(".library-card-title a") as HTMLElement | null)?.focus?.();
    },
    [shown, selectedWorkId],
  );

  useEffect(() => {
    const doc = rootRef.current?.ownerDocument;
    if (doc === undefined || doc === null) return;
    const ownerDoc = doc;
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (paletteOpen || dialogOpen) return;
      const root = rootRef.current;
      const targetNode = event.target as Node | null;
      if (
        root !== null &&
        targetNode !== null &&
        targetNode !== ownerDoc &&
        targetNode !== ownerDoc.body &&
        targetNode !== ownerDoc.documentElement &&
        !root.contains(targetNode)
      ) {
        return;
      }
      const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
      const tag = target?.tagName?.toUpperCase() ?? "";
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && (event.key === "\\" || event.key.toLowerCase() === "b") && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setRailCollapsed((prev) => !prev);
        return;
      }
      if (event.key === "Escape") {
        setKeyboardPreviewId(null);
        setHoveredWorkId(null);
      }
      if (event.key === "Escape" && inInput && (target as { id?: string } | null)?.id === "library-search") {
        if (query !== "") {
          setQuery("");
          setVisibleCount(LIBRARY_RENDER_BATCH_SIZE);
        }
        (rootRef.current?.querySelector("#library-search") as HTMLElement | null)?.blur?.();
        return;
      }
      if (inInput || meta || event.altKey) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (event.key === "Enter" && activeWork !== null && tag !== "A" && tag !== "BUTTON" && tag !== "SUMMARY") {
        event.preventDefault();
        options.navigate?.({ workId: activeWork.id, kind: activeWork.kind });
        return;
      }

      if (!readLibraryVimNav()) return;
      if (event.key === "j") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "k") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "/") {
        event.preventDefault();
        (rootRef.current?.querySelector("#library-search") as HTMLElement | null)?.focus?.();
      } else if (event.key === "e" && activeWork !== null) {
        event.preventDefault();
        options.navigate?.({ workId: activeWork.id, kind: activeWork.kind });
      } else if (event.key === "p" && activeWork?.kind === "presentation" && options.presentWork !== undefined) {
        event.preventDefault();
        options.presentWork(activeWork);
      }
    }
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, [paletteOpen, dialogOpen, query, moveSelection, activeWork, options]);
  const kindLabel = KIND_LABELS[filter];
  const countLabel = `${filtered.length} ${filtered.length === 1 ? kindLabel : `${kindLabel}s`}${
    query.trim() !== "" ? ` · ${visible.length} shown` : ""
  }`;
  const isEmptyState = visible.length === 0 && query.trim() === "";
  const nodes = useMemo(() => works.map((work) => ({ id: work.id, title: work.title })), [works]);
  const handleChanged = useCallback(
    (notice: string | null, tone?: NoticeTone) => {
      void reload(notice, tone);
    },
    [reload],
  );

  useEffect(() => {
    const button = loadMoreRef.current;
    if (button === null || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.target === button && entry.isIntersecting)) {
          setVisibleCount((count) => count + LIBRARY_RENDER_BATCH_SIZE);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [hasMore, visible.length]);

  function selectFilter(next: LibraryFilter, event: MouseEvent<HTMLAnchorElement>): void {
    const href = localTarget(
      options.resolveLibraryUrl?.(next) ?? `#library/${next}`,
      "Library tab",
    );
    if (options.navigate !== undefined) {
      event.preventDefault();
      setFilter(next);
      setVisibleCount(LIBRARY_RENDER_BATCH_SIZE);
      options.navigate({ url: href });
    }
  }

  function libraryHref(next: LibraryFilter): string {
    return localTarget(options.resolveLibraryUrl?.(next) ?? `#library/${next}`, "Library tab");
  }

  function openCreate(kind: WorkKind): void {
    setDialogKind(kind);
    setDialogName("");
    setDialogOpen(true);
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = dialogName.trim();
    if (name === "") return;
    try {
      const spaces = await host.library.listWorkspaces();
      const space = spaces[0];
      if (space === undefined) return;
      setDialogOpen(false);
      const created = await host.library.createWork({
        workspaceId: space.id,
        title: name,
        kind: dialogKind,
        text: buildNewWorkSource({ kind: dialogKind, title: name }),
      });
      options.onLibraryEvent?.({ type: "created", work: created });
      await reload();
      options.navigate?.({ workId: created.id, kind: created.kind });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : String(error), "error");
    }
  }

  const emptyKindLabel = filter === "all" ? "work" : filter === "documents" ? "document" : "presentation";

  const handleSelectWork = useCallback((work: WorkSummary) => {
    setSelectedWorkId(work.id);
    setHoveredWorkId(null);
  }, []);

  const handleHoverWork = useCallback((work: WorkSummary | null) => {
    if (work === null) return;
    setHoveredWorkId(work.id);
    setKeyboardPreviewId(null);
  }, []);

  const vimNavEnabled = readLibraryVimNav();

  return (
    <div ref={rootRef} className={`library-shared-view library-arc-shell${railCollapsed ? " is-rail-collapsed" : ""}`}>
      <div
        className="library-rail-wrap"
        onMouseLeave={() => {
          setHoveredWorkId(null);
        }}
      >
        <aside className="library-rail" aria-label="Works directory">
          <header className="library-hero">
            <div className="library-rail-top">
              <div className="library-kicker flex items-center gap-2">
                <p className="eyebrow m-0 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">
                  Workspace
                </p>
                <span
                  id="library-count"
                  className="library-count rounded-full border border-[#304047] bg-[#202c32] px-2 py-0.5 text-xs font-bold text-[#aab7b1]"
                >
                  {ready ? countLabel : "…"}
                </span>
              </div>
              <button
                type="button"
                className="library-rail-toggle"
                aria-label={railCollapsed ? "Show sidebar" : "Hide sidebar"}
                title="Toggle sidebar (⌘B)"
                onClick={() => setRailCollapsed((prev) => !prev)}
              >
                {railCollapsed ? "»" : "«"}
              </button>
            </div>
            <h1 id="library-title" className="mb-0 text-2xl font-bold">
              Library
            </h1>
            <p id="library-description" className="subheading mt-1 text-[#6f675c]">
              {FILTER_DESCRIPTIONS[filter]}
            </p>
            <div className="library-actions" data-client-slot-target="actions" />
            <label className="search-box" htmlFor="library-search">
              <span aria-hidden="true">⌕</span>
              <input
                id="library-search"
                type="search"
                placeholder="Search Works"
                autoComplete="off"
                aria-label="Search Works"
                value={query}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setVisibleCount(LIBRARY_RENDER_BATCH_SIZE);
                }}
              />
              <kbd>⌘ K</kbd>
            </label>
          </header>

          <section className="library-browser" aria-label="Browse your library">
            <nav className="library-tabs" aria-label="Library views">
              {(Object.keys(KIND_LABELS) as LibraryFilter[]).map((name) => (
                <a
                  key={name}
                  id={name === "all" ? "show-work-list" : name === "documents" ? "show-documents" : "show-presentations"}
                  className={`library-tab${name === filter ? " is-active" : ""}`}
                  data-library-tab={name}
                  href={libraryHref(name)}
                  aria-current={name === filter ? "page" : undefined}
                  onClick={(event) => selectFilter(name, event)}
                >
                  {name === "all" ? "All" : name === "documents" ? "Documents" : "Presentations"}
                </a>
              ))}
            </nav>
            <div
              id="notice"
              className="notice"
              role="status"
              aria-live="polite"
              data-tone={noticeTone}
              hidden={notice === ""}
            >
              {notice}
            </div>
            <section
              id="work-list"
              className="library-list"
              role="list"
              aria-label={`Saved ${filter}`}
              hidden={visible.length === 0 && !isEmptyState}
            >
              {shown.map((work) => (
                <LibraryCard
                  key={`${work.id}:${work.updatedAt ?? ""}`}
                  host={host}
                  work={work}
                  documentNodes={nodes}
                  options={options}
                  onChanged={handleChanged}
                  isSelected={work.id === activeSelectedId}
                  onSelect={handleSelectWork}
                  onHover={handleHoverWork}
                />
              ))}
            </section>
            <button
              ref={loadMoreRef}
              id="library-load-more"
              className="button secondary library-load-more mt-4"
              type="button"
              aria-controls="work-list"
              hidden={!hasMore}
              onClick={() => setVisibleCount((count) => count + LIBRARY_RENDER_BATCH_SIZE)}
            >
              Load more Works
            </button>
            <div
              id="empty-library"
              className="empty-state flex flex-col gap-3 rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-4"
              hidden={!isEmptyState}
            >
              <div>
                <h2 className="mb-1 text-lg font-bold" data-library-empty-title>
                  {`No ${emptyKindLabel}${filter === "all" ? "" : "s"} yet.`}
                </h2>
                <p className="text-sm text-[#6f675c]" data-library-empty-copy>
                  Start with Markdown. Elef keeps your source and assets in your library.
                </p>
              </div>
              <button
                className="button primary inline-flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-full border border-[#6d4aff] bg-[#6d4aff] px-4 py-2 font-bold text-white no-underline hover:brightness-95"
                type="button"
                data-kind={filter === "documents" ? "document" : "presentation"}
                onClick={() => openCreate(filter === "documents" ? "document" : "presentation")}
              >
                {filter === "documents" ? "Create a document" : "Create a presentation"}
              </button>
            </div>
            <p id="library-no-results" className="library-no-results" role="status" hidden={query.trim() === "" || visible.length > 0}>
              No Works match this search.
            </p>
          </section>
        </aside>

        {popoverWork !== null && !railCollapsed ? (
          <div className="library-hover-popover" role="region" aria-label="First-page preview">
            <div className="library-hover-popover-head">
              <div>
                <span className="library-stage-kind">
                  {popoverWork.kind === "presentation" ? "Presentation" : "Document"}
                </span>
                <p className="library-stage-title">{popoverWork.title}</p>
              </div>
              <div className="library-stage-actions">
                {popoverWork.kind === "presentation" && options.presentWork !== undefined ? (
                  <button
                    type="button"
                    className="library-stage-action"
                    onClick={() => options.presentWork?.(popoverWork)}
                  >
                    Present {vimNavEnabled ? <kbd>p</kbd> : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="library-stage-action is-primary"
                  onClick={() => options.navigate?.({ workId: popoverWork.id, kind: popoverWork.kind })}
                >
                  Edit <kbd>↵</kbd>
                </button>
              </div>
            </div>
            <div className="library-stage-preview">
              <StagePreview host={host} work={popoverWork} options={options} />
            </div>
          </div>
        ) : null}
      </div>

      <main className="library-stage library-quickstart" aria-label="Quick start canvas">
        <div className="library-stage-bar">
          <div className="library-stage-bar-left">
            {railCollapsed ? (
              <button
                type="button"
                className="library-stage-action"
                onClick={() => setRailCollapsed(false)}
              >
                Show sidebar <kbd>⌘B</kbd>
              </button>
            ) : (
              <span className="library-stage-hint">
                <kbd>⌘B</kbd> toggle sidebar · {vimNavEnabled ? "j/k or ↑/↓ preview · / search" : "↑/↓ preview · ⌘K commands"}
              </span>
            )}
          </div>
        </div>

        <div className="library-stage-content">
          {options.graphEnabled !== false && (
            <section
              id="document-graph-view"
              className="document-graph-panel mb-6 rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-5"
              data-client-slot-target="graph"
              hidden
              aria-labelledby="document-graph-heading"
            />
          )}
          <div data-client-slot-target="lineage" />
          <div className="library-quickstart-canvas">
            <p className="library-quickstart-eyebrow">Elef</p>
            <h2 className="library-quickstart-title">A calm place for your ideas.</h2>
            <p className="library-quickstart-copy">
              Hover any work in the sidebar to peek at its first page, or start something new.
            </p>
            <div className="library-quickstart-actions">
              <button
                type="button"
                className="library-stage-action is-primary"
                onClick={() => openCreate("document")}
              >
                + New Document
              </button>
              <button
                type="button"
                className="library-stage-action"
                onClick={() => openCreate("presentation")}
              >
                + New Presentation
              </button>
            </div>
          </div>
        </div>
      </main>

      {options.palette !== undefined &&
        typeof document !== "undefined" &&
        createPortal(
          <CommandPalette
            open={paletteOpen}
            initialMode={paletteMode}
            commands={options.palette.commands}
            works={works.map((work) => ({ id: work.id, title: work.title, kind: work.kind }))}
            onOpenWork={(selected) => {
              const kind = selected.kind === "document" ? "document" : "presentation";
              options.navigate?.({ workId: selected.id, kind });
            }}
            onClose={() => {
              setPaletteOpen(false);
              // Keyboard home: return focus where ⌘K was pressed — the
              // editor caret when editing, the search box when browsing. A
              // disconnected invoker (navigated away mid-palette) falls back
              // to library search, the old behavior. Command runs that open
              // a surface re-focus afterwards through their own autofocus, so
              // this never steals a dialog's focus.
              const invoker = invokeRef.current;
              invokeRef.current = null;
              if (invoker !== null && invoker.isConnected && typeof invoker.focus === "function") {
                invoker.focus();
              } else {
                rootRef.current?.querySelector<HTMLElement>("#library-search")?.focus?.();
              }
            }}
          />,
          document.body,
        )}

      <dialog ref={dialogRef} id="create-dialog" className="app-dialog" onCancel={() => setDialogOpen(false)}>
        <form id="create-form" onSubmit={(event) => void create(event)}>
          <label htmlFor="new-work-name">Name</label>
          <input
            id="new-work-name"
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            placeholder="A clear, memorable title"
            value={dialogName}
            onInput={(event) => setDialogName(event.currentTarget.value)}
          />
          <label htmlFor="new-work-kind">Format</label>
          <select
            id="new-work-kind"
            name="kind"
            value={dialogKind}
            onChange={(event) => setDialogKind(event.currentTarget.value === "document" ? "document" : "presentation")}
          >
            <option value="presentation">Presentation</option>
            <option value="document">Document</option>
          </select>
          <button id="create-submit" type="submit">
            Create
          </button>
          <button type="button" onClick={() => setDialogOpen(false)}>
            Cancel
          </button>
        </form>
      </dialog>
    </div>
  );
}
