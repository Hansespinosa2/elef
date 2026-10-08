import { useEffect, useRef, useState } from "react";
import type { FormEvent, JSX, MouseEvent, RefObject } from "react";
import type { ElefHost, WorkKind, WorkSummary } from "@elef/contracts";
import { renderPreviewCore } from "@elef/renderer";
import type { CardAction, ElefMountOptions } from "../../application/types.js";
import { SafeHtml } from "../../ui/SafeHtml.js";
import { sanitizePreview } from "../../ui/sanitize.js";
import { useSlideScale } from "./useSlideScale.js";

export interface LibraryCardProps {
  readonly host: ElefHost;
  readonly work: WorkSummary;
  readonly documentNodes: readonly unknown[];
  readonly options: ElefMountOptions;
  readonly onChanged: (notice: string | null) => void;
}

export function cardDomId(work: WorkSummary): string {
  return `${work.kind === "presentation" ? "presentation" : "document"}_${work.id}`;
}

function localTarget(value: string, label: string): string {
  if (!/^(?:\/(?!\/)|#)/.test(value)) throw new TypeError(`${label} must be a local target`);
  return value;
}

function formattedUpdateDate(updatedAt: string | undefined): string {
  const timestamp = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "date unavailable";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function libraryMetadata(kind: WorkKind, updatedAt: string | undefined): string {
  const description = kind === "document" ? "Continuous Markdown" : "Markdown slides";
  return `${description} · Updated ${formattedUpdateDate(updatedAt)}`;
}

interface PreviewState {
  readonly phase: "idle" | "loading" | "ready" | "unavailable";
  readonly html?: string;
  readonly theme?: string;
  readonly typography?: string;
  readonly message?: string;
}

function previewMessage(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return code === "too_large"
    ? "Preview unavailable for large source files."
    : "Preview unavailable.";
}

export function LibraryCard({ host, work, documentNodes, options, onChanged }: LibraryCardProps): JSX.Element {
  const navigate = options.navigate;
  const editUrl = localTarget(
    options.resolveWorkUrl?.(work) ?? `#${encodeURIComponent(work.id)}`,
    "Library cards require a local navigation target",
  );

  function open(event: MouseEvent): void {
    if (navigate === undefined) return;
    event.preventDefault();
    navigate({ workId: work.id, kind: work.kind });
  }

  return (
    <article id={cardDomId(work)} className="library-card rounded-2xl border border-[#ddd5c8] bg-[#fffdf8]" role="listitem">
      <div className="library-card-media">
        <CardPreview host={host} work={work} documentNodes={documentNodes} options={options} />
        <a className="library-card-open" href={editUrl} aria-label={`Edit ${work.title}`} onClick={open} />
        <div className="library-card-controls">
          <PreviewControl work={work} options={options} onOpen={open} />
          <details className="library-card-menu">
            <summary className="library-card-menu-trigger" aria-label={`More actions for ${work.title}`}>
              <span aria-hidden="true">...</span>
            </summary>
            <div className="library-card-menu-options">
              <RenameControl host={host} work={work} options={options} onChanged={onChanged} />
              <ExtraActions work={work} options={options} />
              {work.kind === "presentation" && options.presentWork !== undefined ? (
                <button
                  className="deck-action"
                  type="button"
                  onClick={() => options.presentWork?.(work)}
                >
                  Present
                </button>
              ) : null}
              <DeleteControl host={host} work={work} options={options} onChanged={onChanged} />
            </div>
          </details>
        </div>
      </div>
      <div className="library-card-body">
        <p className="library-card-eyebrow eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em] text-[#6d4aff]">
          {work.kind === "document" ? "Document" : "Presentation"}
        </p>
        <h2 className="library-card-title mb-2 text-2xl font-bold">
          <a className="hover:underline" href={editUrl} onClick={open}>
            {work.title}
          </a>
        </h2>
        <p className="library-card-meta text-[#6f675c]">{libraryMetadata(work.kind, work.updatedAt)}</p>
        {options.cardNote?.(work) ? (
          <p className="library-card-note text-sm text-[#6f675c]">{options.cardNote?.(work)}</p>
        ) : null}
      </div>
      {(work.warnings ?? []).length > 0 ? (
        <p className="deck-warning" role="note">
          {(work.warnings ?? []).join(" ")}
        </p>
      ) : null}
    </article>
  );
}

const PREVIEW_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M10.2 8.9 15.6 12l-5.4 3.1V8.9Z" />
  </svg>
);

function PreviewControl({
  work,
  options,
  onOpen,
}: {
  readonly work: WorkSummary;
  readonly options: ElefMountOptions;
  readonly onOpen: (event: MouseEvent) => void;
}): JSX.Element {
  const label = `Preview ${work.title}`;
  const target = options.resolvePreviewUrl?.(work) ?? null;
  if (target !== null) {
    return (
      <a
        className="library-card-preview-button"
        aria-label={label}
        title={label}
        href={localTarget(target, "Preview target")}
      >
        {PREVIEW_ICON}
        <span className="sr-only">Preview</span>
      </a>
    );
  }
  return (
    <button
      className="library-card-preview-button"
      type="button"
      aria-label={label}
      title={label}
      onClick={onOpen}
    >
      {PREVIEW_ICON}
      <span className="sr-only">Preview</span>
    </button>
  );
}

function RenameControl({
  host,
  work,
  options,
  onChanged,
}: {
  readonly host: ElefHost;
  readonly work: WorkSummary;
  readonly options: ElefMountOptions;
  readonly onChanged: (notice: string | null) => void;
}): JSX.Element {
  const [title, setTitle] = useState(work.title);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const next = title.trim();
    if (next === "" || next === work.title) return;
    const renamed = await host.library.renameWork(work.id, next);
    onChanged(options.operationNotice?.("renamed", renamed) ?? null);
  }

  return (
    <details className="library-card-submenu rename-menu">
      <summary>Rename</summary>
      <form className="library-rename" onSubmit={(event) => void submit(event)}>
        <input
          id={`${cardDomId(work)}_rename_title`}
          type="text"
          value={title}
          aria-label={`Rename ${work.title}`}
          required
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <button className="deck-action" type="submit">
          Save title
        </button>
      </form>
    </details>
  );
}

function ExtraActions({
  work,
  options,
}: {
  readonly work: WorkSummary;
  readonly options: ElefMountOptions;
}): JSX.Element | null {
  const actions = options.extraCardActions?.(work) ?? [];
  if (actions.length === 0) return null;
  return (
    <>
      {actions.map((action, index) => (
        <CardActionItem key={index} work={work} action={action} />
      ))}
    </>
  );
}

function CardActionItem({
  work,
  action,
}: {
  readonly work: WorkSummary;
  readonly action: CardAction;
}): JSX.Element {
  if (action.children !== undefined && action.children.length > 0) {
    const menuClass = action.menuClass ?? "library-card-submenu";
    return (
      <details className={menuClass}>
        <summary>{action.label}</summary>
        <div className={`${menuClass}-options`}>
          {action.children.map((child, index) => (
            <CardActionItem key={index} work={work} action={child} />
          ))}
        </div>
      </details>
    );
  }
  if (action.href !== undefined) {
    return (
      <a className="deck-action" href={localTarget(action.href, "Library action")}>
        {action.label}
      </a>
    );
  }
  return (
    <button className="deck-action" type="button" onClick={() => action.run?.(work)}>
      {action.label}
    </button>
  );
}

function DeleteControl({
  host,
  work,
  options,
  onChanged,
}: {
  readonly host: ElefHost;
  readonly work: WorkSummary;
  readonly options: ElefMountOptions;
  readonly onChanged: (notice: string | null) => void;
}): JSX.Element {
  async function remove(): Promise<void> {
    const confirmed = (await options.confirmDelete?.(work)) ?? true;
    if (!confirmed) return;
    await host.library.deleteWork(work.id);
    onChanged(options.operationNotice?.("deleted", work) ?? null);
  }

  return (
    <button
      className="deck-action danger is-danger"
      type="button"
      onClick={() => void remove()}
    >
      Delete
    </button>
  );
}

function CardPreview({
  host,
  work,
  documentNodes,
  options,
}: {
  readonly host: ElefHost;
  readonly work: WorkSummary;
  readonly documentNodes: readonly unknown[];
  readonly options: ElefMountOptions;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<PreviewState>({ phase: "idle" });
  useSlideScale(containerRef as RefObject<HTMLElement | null>, work.kind === "document" ? { width: 794, height: 1123 } : {});

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== container || !entry.isIntersecting) continue;
          observer.unobserve(container);
          setStarted(true);
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Keyed ref-guard instead of a dep array: listing `state` in deps would
  // re-run (and cancel) the in-flight load on every phase transition. The
  // key reloads the preview when the work identity or revision changes.
  // Liveness comes from a mount-only ref: this effect's own cleanup runs on
  // every render, so it must not invalidate the load it just started.
  const loadKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    const key = `${work.id}:${work.updatedAt ?? ""}`;
    if (loadKey.current === key) return;
    loadKey.current = key;
    setState({ phase: "loading" });
    async function load(): Promise<void> {
      function commit(next: PreviewState): void {
        if (mounted.current && loadKey.current === key) setState(next);
      }
      try {
        const snapshot = await host.works.getWork(work.id);
        const rendered = renderPreviewCore({
          source: snapshot.text,
          kind: work.kind,
          title: work.title,
          deckId: work.id,
          mediaBaseUrl: options.resolveMediaBaseUrl?.(work) ?? "",
          documentNodes,
        });
        commit({ phase: "ready", html: rendered.html, theme: rendered.style.theme, typography: rendered.style.typography });
      } catch (error) {
        commit({ phase: "unavailable", message: previewMessage(error) });
      }
    }
    void load();
  });

  if (state.phase !== "ready" || state.html === undefined) {
    return (
      <div ref={containerRef} className="library-card-preview" aria-hidden="true" inert>
        {state.phase === "unavailable" ? (state.message ?? "Preview unavailable.") : "Loading preview…"}
      </div>
    );
  }
  const theme = state.theme ?? "match";
  const typography = state.typography ?? "book";
  const stageClass =
    work.kind === "presentation"
      ? `library-preview-stage presentation-surface work-surface slides slides-theme-${theme} slides-typography-${typography} work-theme-${theme} work-typography-${typography}`
      : `library-preview-page document-reader document-theme-${theme} document-typography-${typography} work-theme-${theme} work-typography-${typography}`;
  const kind = work.kind;
  const mediaBaseUrl = options.resolveMediaBaseUrl?.(work) ?? "";
  return (
    <div ref={containerRef} className="library-preview" data-preview-state="ready">
      <div className="library-card-preview" aria-hidden="true" inert>
        <SafeHtml
          className={stageClass}
          html={state.html}
          sanitize={(container, html) =>
            sanitizePreview(container, html, {
              interactive: false,
              documentPagination: kind === "document",
              mediaBaseUrl,
            })
          }
        />
      </div>
    </div>
  );
}
