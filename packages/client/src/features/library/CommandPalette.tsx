import { useEffect, useId, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import type { LibraryPaletteCommand, PaletteMode } from "../../application/types.js";
import { libraryNameMatches } from "./filtering.js";

export type { PaletteMode };

// Shared command palette: commands mode plus quick-open search mode, one
// component for every host. Hosts inject runnable commands and the works to
// search; quick-open matches locally loaded titles (case- and
// Unicode-insensitive, like the library filter), while server hosts keep
// their full-text endpoint behind their own adapter. Styled by the web
// `command-palette-*` classes so it is visually identical everywhere.
//
// Lives in the library feature (not shortcuts): the boundary rule forbids
// imports across features/, and this component renders library works through
// the library filter. The shortcuts feature keeps the host-agnostic
// vocabulary (registry, chords, display); this is its library surface.
export interface PaletteWork {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly initialMode: PaletteMode;
  readonly commands: readonly LibraryPaletteCommand[];
  readonly works: readonly PaletteWork[];
  readonly onOpenWork: (work: PaletteWork) => void;
  readonly onClose: () => void;
  readonly searchAvailable?: boolean;
}

function commandMatches(command: LibraryPaletteCommand, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    command.label.toLowerCase().includes(needle) || command.description.toLowerCase().includes(needle)
  );
}

export function CommandPalette({
  open,
  initialMode,
  commands,
  works,
  onOpenWork,
  onClose,
  searchAvailable = true,
}: CommandPaletteProps): JSX.Element | null {
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const headingId = useId();
  const resultsId = useId();

  // A fresh open always restarts from the host-requested mode with a clear
  // query: stale filters across opens mislead keyboard users.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode(initialMode);
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open, initialMode]);

  useEffect(() => {
    setSelected(0);
  }, [query, mode]);

  if (!open) return null;

  const rows =
    mode === "commands"
      ? commands.filter((command) => commandMatches(command, query))
      : works.filter((work) => libraryNameMatches(work.title, query));
  const bounded = rows.length === 0 ? 0 : selected % rows.length;
  const status =
    mode === "commands"
      ? `${rows.length} command${rows.length === 1 ? "" : "s"}`
      : query.trim() === ""
        ? "Search all presentations and documents."
        : `${rows.length} result${rows.length === 1 ? "" : "s"}`;

  function activate(index: number): void {
    const row = rows[index];
    if (row === undefined) return;
    if (mode === "commands") (row as LibraryPaletteCommand).run();
    else onOpenWork(row as PaletteWork);
    onClose();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" && rows.length > 0) {
      event.preventDefault();
      setSelected((value) => (value + 1) % rows.length);
    } else if (event.key === "ArrowUp" && rows.length > 0) {
      event.preventDefault();
      setSelected((value) => (value - 1 + rows.length) % rows.length);
    } else if (event.key === "Home" && rows.length > 0) {
      event.preventDefault();
      setSelected(0);
    } else if (event.key === "End" && rows.length > 0) {
      event.preventDefault();
      setSelected(rows.length - 1);
    } else if (event.key === "Enter" && rows.length > 0) {
      event.preventDefault();
      activate(bounded);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault()
      onClose()
    }
    if (event.key !== "Tab") return
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    if (!elements.length) return
    const current = elements.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement)
    const next = event.shiftKey ? (current <= 0 ? elements.length - 1 : current - 1) : (current + 1) % elements.length
    event.preventDefault()
    elements[next]?.focus()
  }

  return (
    <div className="command-palette" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={onDialogKeyDown}>
      <div className="command-palette-panel">
        <div className="command-palette-heading">
          <h2 id={headingId}>{mode === "commands" ? "Command palette" : "Search works"}</h2>
          <button type="button" aria-label="Close palette" onClick={onClose}>
            Esc
          </button>
        </div>
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          placeholder={mode === "commands" ? "Filter commands…" : "Search by title…"}
          aria-controls={resultsId}
          aria-describedby={`${headingId}-hint`}
          aria-autocomplete="list"
          role="combobox"
          aria-expanded="true"
          aria-activedescendant={rows.length === 0 ? undefined : `${resultsId}-${bounded}`}
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onInputKeyDown}
        />
        <p id={`${headingId}-hint`} className="command-palette-hint">
          ↑/↓ move · Enter choose · Esc close
        </p>
        {searchAvailable && <div className="command-palette-filters" role="group" aria-label="Palette mode">
          {(["commands", "search"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
            >
              {candidate === "commands" ? "Commands" : "Search works"}
            </button>
          ))}
        </div>}
        <div id={resultsId} className="command-palette-results" role="listbox" aria-label="Results">
          {rows.length === 0 ? (
            <p className="command-palette-empty" role="status">
              {mode === "commands" ? "No commands match." : "No works match this search."}
            </p>
          ) : (
            rows.map((row, index) =>
              mode === "commands" ? (
                <button
                  key={(row as LibraryPaletteCommand).id}
                  id={`${resultsId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === bounded}
                  className="command-palette-option"
                  onClick={() => activate(index)}
                  onMouseEnter={() => setSelected(index)}
                >
                  <strong>{(row as LibraryPaletteCommand).label}</strong>
                  <span>{(row as LibraryPaletteCommand).description}</span>
                  {(row as LibraryPaletteCommand).chord !== null && (
                    <kbd className="command-palette-shortcut">{(row as LibraryPaletteCommand).chord}</kbd>
                  )}
                </button>
              ) : (
                <button
                  key={(row as PaletteWork).id}
                  id={`${resultsId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === bounded}
                  className="command-palette-option"
                  onClick={() => activate(index)}
                  onMouseEnter={() => setSelected(index)}
                >
                  <strong>{(row as PaletteWork).title}</strong>
                  <span>{(row as PaletteWork).kind}</span>
                </button>
              ),
            )
          )}
        </div>
        <p className="command-palette-status" role="status" aria-live="polite">
          {status}
        </p>
      </div>
    </div>
  );
}
