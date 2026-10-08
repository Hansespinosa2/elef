import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX, MouseEvent } from "react";
import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";
import type { ElefMountOptions, LibraryFilter } from "../../application/types.js";
import { parseLibraryRoute } from "../../application/router.js";
import { filterWorks } from "./filtering.js";
import { LibraryCard } from "./LibraryCard.js";

export interface LibraryAppProps {
  readonly host: ElefHost;
  readonly initialFilter: LibraryFilter;
  readonly options: ElefMountOptions;
  readonly registerReloader?: (reload: () => Promise<void>) => void;
}

export const LIBRARY_RENDER_BATCH_SIZE = 48;
export const CREATE_WORK_EVENT = "elef:create-work";

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

export function LibraryApp({ host, initialFilter, options, registerReloader }: LibraryAppProps): JSX.Element {
  const [works, setWorks] = useState<readonly WorkSummary[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [visibleCount, setVisibleCount] = useState(LIBRARY_RENDER_BATCH_SIZE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<WorkKind>("presentation");
  const [dialogName, setDialogName] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const reload = useCallback(
    async (notice: string | null = null): Promise<void> => {
      try {
        const spaces = await host.library.listWorkspaces();
        const loaded: WorkSummary[] = [];
        for (const space of spaces) {
          loaded.push(...(await host.library.listWorks(space.id)));
        }
        setWorks(loaded);
        setReady(true);
        setNotice(notice ?? "");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [host],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    registerReloader?.(() => reload());
  }, [registerReloader, reload]);

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

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    function onCreate(event: Event): void {
      const kind = (event as CustomEvent).detail?.kind;
      setDialogKind(kind === "document" ? "document" : "presentation");
      setDialogName("");
      setDialogOpen(true);
    }
    root.addEventListener(CREATE_WORK_EVENT, onCreate as EventListener);
    return () => root.removeEventListener(CREATE_WORK_EVENT, onCreate as EventListener);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (dialogOpen) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
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
  const kindLabel = KIND_LABELS[filter];
  const countLabel = `${filtered.length} ${filtered.length === 1 ? kindLabel : `${kindLabel}s`}${
    query.trim() !== "" ? ` · ${visible.length} shown` : ""
  }`;
  const isEmptyState = visible.length === 0 && query.trim() === "";
  const nodes = works.map((work) => ({ id: work.id, title: work.title }));

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
      });
      options.onLibraryEvent?.({ type: "created", work: created });
      await reload();
      options.navigate?.({ workId: created.id, kind: created.kind });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  const emptyKindLabel = filter === "all" ? "work" : filter === "documents" ? "document" : "presentation";

  return (
    <div ref={rootRef} className="library-shared-view">
      <header className="library-hero mb-8 flex items-end justify-between gap-4 max-[920px]:flex-col max-[920px]:items-stretch">
        <div>
          <div className="library-kicker flex items-center gap-3">
            <p className="eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">
              Your workspace
            </p>
            <span
              id="library-count"
              className="library-count rounded-full border border-[#304047] bg-[#202c32] px-2 py-1 text-xs font-bold text-[#aab7b1]"
            >
              {ready ? countLabel : "…"}
            </span>
          </div>
          <h1 id="library-title" className="mb-0 text-4xl font-bold">
            Library
          </h1>
          <p id="library-description" className="subheading mt-2 text-[#6f675c]">
            {FILTER_DESCRIPTIONS[filter]}
          </p>
        </div>
        <div className="library-actions" data-client-slot-target="actions" />
        <label className="search-box" htmlFor="library-search">
          <span aria-hidden="true">⌕</span>
          <input
            id="library-search"
            type="search"
            placeholder="Search decks"
            autoComplete="off"
            aria-label="Search decks"
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
        <nav className="library-tabs mb-6 flex flex-wrap gap-2" aria-label="Library views">
          {(Object.keys(KIND_LABELS) as LibraryFilter[]).map((name) => (
            <a
              key={name}
              id={name === "all" ? "show-deck-list" : name === "documents" ? "show-documents" : "show-presentations"}
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
        <div id="notice" className="notice" role="status" aria-live="polite" hidden={notice === ""}>
          {notice}
        </div>
        <section
          id="document-graph-view"
          className="document-graph-panel mt-8 rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-5"
          data-client-slot-target="graph"
          hidden
          aria-labelledby="document-graph-heading"
        />
        <div data-client-slot-target="lineage" />
        <section
          id="deck-list"
          className="library-list mt-8 grid gap-4"
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
              onChanged={(notice) => void reload(notice)}
            />
          ))}
        </section>
        <button
          ref={loadMoreRef}
          id="library-load-more"
          className="button secondary library-load-more mt-6"
          type="button"
          aria-controls="deck-list"
          hidden={!hasMore}
          onClick={() => setVisibleCount((count) => count + LIBRARY_RENDER_BATCH_SIZE)}
        >
          Load more decks
        </button>
        <div
          id="empty-library"
          className="empty-state flex items-center justify-between rounded-2xl border border-[#ddd5c8] bg-[#fffdf8] p-5 max-[920px]:flex-col max-[920px]:items-stretch"
          hidden={!isEmptyState}
        >
          <div>
            <h2 className="mb-2 text-2xl font-bold" data-library-empty-title>
              {`No ${emptyKindLabel}${filter === "all" ? "" : "s"} yet.`}
            </h2>
            <p className="text-[#6f675c]" data-library-empty-copy>
              Start with Markdown. Elef keeps your source and assets in your library.
            </p>
          </div>
          <button
            className="button primary inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-full border border-[#6d4aff] bg-[#6d4aff] px-4 py-2 font-bold text-white no-underline hover:brightness-95"
            type="button"
            data-kind={filter === "documents" ? "document" : "presentation"}
            onClick={() => openCreate(filter === "documents" ? "document" : "presentation")}
          >
            {filter === "documents" ? "Create a document" : "Create a presentation"}
          </button>
        </div>
        <p id="library-no-results" className="library-no-results" role="status" hidden={query.trim() === "" || visible.length > 0}>
          No decks match this search.
        </p>
      </section>

      <dialog ref={dialogRef} id="create-dialog" className="app-dialog" onCancel={() => setDialogOpen(false)}>
        <form id="create-form" onSubmit={(event) => void create(event)}>
          <label htmlFor="new-deck-name">Name</label>
          <input
            id="new-deck-name"
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            placeholder="A clear, memorable title"
            value={dialogName}
            onInput={(event) => setDialogName(event.currentTarget.value)}
          />
          <label htmlFor="new-deck-kind">Format</label>
          <select
            id="new-deck-kind"
            name="kind"
            value={dialogKind}
            onChange={(event) => setDialogKind(event.currentTarget.value === "document" ? "document" : "presentation")}
          >
            <option value="presentation">Presentation</option>
            <option value="document">Document</option>
          </select>
          <button type="submit">Create</button>
          <button type="button" onClick={() => setDialogOpen(false)}>
            Cancel
          </button>
        </form>
      </dialog>
    </div>
  );
}
