import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import { SafeHtml } from "../../ui/SafeHtml.js";
import { sanitizePreview } from "../../ui/sanitize.js";
import type {
  AuthoringEntry,
  AuthoringRegistries,
  AuthoringRegistryName,
  AuthoringRegistryTransport,
  MathShortcutEntry,
  SnippetEntry,
} from "./authoringRegistry.js";
import {
  authoringFailureMessage,
  buildAuthoringEntry,
  entryLabel,
  filterAuthoringEntries,
  mathExample,
  removeAuthoringEntry,
  snippetExample,
  upsertAuthoringEntry,
  writeAuthoringRegistry,
} from "./authoringRegistry.js";

export interface AuthoringDialogProps {
  readonly transport: AuthoringRegistryTransport;
  readonly initialRegistry?: AuthoringRegistryName;
  readonly openNew?: boolean;
  readonly entryId?: string | number | null;
  readonly renderExample?: (source: string) => string | Promise<string>;
  readonly reloadEditorRegistry?: () => Promise<void>;
  readonly onSaved?: (message: string) => void;
  readonly onClose?: () => void;
}

interface FormFields {
  name: string;
  description: string;
  trigger: string;
  category: string;
  body: string;
  prefix: string;
  aliases: string;
  expansion: string;
}

const EMPTY_FORM: FormFields = {
  name: "",
  description: "",
  trigger: "",
  category: "Markdown",
  body: "",
  prefix: ".",
  aliases: "",
  expansion: "",
};

const SNIPPET_CATEGORIES = ["Markdown", "LaTeX", "Mermaid", "Elef DSL"];

function sanitizeExample(container: Element, html: string): void {
  sanitizePreview(container, html, { interactive: false });
}

function ExamplePreview({ source, renderExample }: { source: string; renderExample: (s: string) => string | Promise<string> }): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHtml(null);
    void Promise.resolve()
      .then(() => renderExample(source))
      .then(
        (rendered) => {
          if (live) setHtml(typeof rendered === "string" ? rendered : source);
        },
        () => {
          if (live) setHtml(source);
        },
      );
    return () => {
      live = false;
    };
  }, [source, renderExample]);
  if (html === null) return <div className="snippet-example-preview rounded-xl p-4">{source}</div>;
  return <SafeHtml html={html} sanitize={sanitizeExample} className="snippet-example-preview rounded-xl p-4" />;
}

export function AuthoringDialog({
  transport,
  initialRegistry = "snippets",
  openNew = false,
  entryId = null,
  renderExample = (source) => source,
  reloadEditorRegistry = async () => {},
  onSaved = () => {},
  onClose = () => {},
}: AuthoringDialogProps): JSX.Element {
  const [registries, setRegistries] = useState<AuthoringRegistries>({ snippets: [], math_shortcuts: [] });
  const [hashes, setHashes] = useState<{ snippets?: string | null; math_shortcuts?: string | null }>({});
  const [activeRegistry, setActiveRegistry] = useState<AuthoringRegistryName>(initialRegistry);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<FormFields>(EMPTY_FORM);
  const [pendingDeletion, setPendingDeletion] = useState<{ entry: AuthoringEntry; registry: AuthoringRegistryName } | null>(null);
  const [writeInProgress, setWriteInProgress] = useState(false);
  const writeRef = useRef(false);
  const stateRef = useRef({ registries, hashes, activeRegistry });
  stateRef.current = { registries, hashes, activeRegistry };

  const load = useCallback(async () => {
    try {
      const result = await transport.readRegistries();
      setRegistries({
        snippets: [...(result.snippets || [])],
        math_shortcuts: [...(result.math_shortcuts || [])],
      });
      setHashes(result.hashes || { snippets: null, math_shortcuts: null });
    } catch {
      setRegistries({ snippets: [], math_shortcuts: [] });
      setHashes({ snippets: null, math_shortcuts: null });
      setStatus("Could not load authoring settings. Check that your work is available.");
    }
  }, [transport]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep-link entry points (edit one entry, or start a new one) resolve after
  // the registries load, mirroring the pre-migration dialog open options.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (entryId !== null && entryId !== undefined) {
      const list = (initialRegistry === "math_shortcuts" ? registries.math_shortcuts : registries.snippets) as readonly AuthoringEntry[];
      const entry = list.find((candidate) => String(candidate.id) === String(entryId));
      if (entry && !entry.built_in) beginEntryForm(entry, initialRegistry);
      return;
    }
    if (openNew) beginEntryForm(null, initialRegistry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registries]);

  function beginEntryForm(entry: AuthoringEntry | null, registry: AuthoringRegistryName): void {
    setActiveRegistry(registry);
    const isSnippet = registry === "snippets";
    const snippet = entry as SnippetEntry | null;
    const math = entry as MathShortcutEntry | null;
    setFields({
      ...EMPTY_FORM,
      name: entry?.name || "",
      description: entry?.description || "",
      trigger: isSnippet ? snippet?.trigger || "" : "",
      category: isSnippet ? snippet?.category || "Markdown" : "Markdown",
      body: isSnippet ? snippet?.body || "" : "",
      prefix: !isSnippet ? math?.prefix || "." : ".",
      aliases: !isSnippet ? (math?.aliases || []).join(", ") : "",
      expansion: !isSnippet ? math?.expansion || "" : "",
    });
    setEditingId(entry ? String(entry.id) : null);
    setFormOpen(true);
    setStatus("");
  }

  async function persist(
    entries: readonly AuthoringEntry[],
    action: string,
    registry: AuthoringRegistryName,
  ): Promise<boolean> {
    if (writeRef.current) return false;
    writeRef.current = true;
    setWriteInProgress(true);
    try {
      const personal = entries.filter((entry) => !entry.built_in);
      await writeAuthoringRegistry({
        registry,
        entries: personal,
        baseHash: stateRef.current.hashes[registry] ?? null,
        writeRegistry: transport.writeRegistry.bind(transport),
        updateLocal: ({ entries: savedEntries, contentHash }) => {
          const current = stateRef.current.registries[registry] as readonly AuthoringEntry[];
          const builtIns = current.filter((entry) => entry.built_in);
          const next = [...builtIns, ...savedEntries.filter((entry) => !entry.built_in)];
          setRegistries({ ...stateRef.current.registries, [registry]: next });
          setHashes({ ...stateRef.current.hashes, [registry]: contentHash ?? null });
        },
        reloadEditorRegistry,
      });
      const label = registry === "snippets" ? "snippet" : "math shortcut";
      const message = `${action} saved (${label}).`;
      setStatus(message);
      onSaved(`${action} saved`);
      setFormOpen(false);
      return true;
    } catch (error) {
      setStatus(authoringFailureMessage(error as { code?: string }, registry));
      return false;
    } finally {
      writeRef.current = false;
      setWriteInProgress(false);
    }
  }

  async function saveEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (writeRef.current) return;
    const registry = stateRef.current.activeRegistry;
    const isSnippet = registry === "snippets";
    const id = editingId || `personal-${crypto.randomUUID()}`;
    try {
      const entry = isSnippet
        ? buildAuthoringEntry("snippets", fields, id)
        : buildAuthoringEntry("math_shortcuts", fields, id);
      const current = stateRef.current.registries[registry] as readonly AuthoringEntry[];
      await persist(upsertAuthoringEntry(current, entry as AuthoringEntry), editingId ? "Changes" : "New entry", registry);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "These settings are invalid.");
    }
  }

  function requestDeletion(entry: AuthoringEntry, registry: AuthoringRegistryName): void {
    if (entry.built_in) return;
    setPendingDeletion({ entry, registry });
  }

  async function confirmDeletion(): Promise<void> {
    const pending = pendingDeletion;
    if (!pending || writeRef.current) return;
    setPendingDeletion(null);
    const current = stateRef.current.registries[pending.registry] as readonly AuthoringEntry[];
    await persist(removeAuthoringEntry(current, pending.entry.id), "Entry deletion", pending.registry);
  }

  const isSnippet = activeRegistry === "snippets";
  const allEntries = (isSnippet ? registries.snippets : registries.math_shortcuts) as readonly AuthoringEntry[];
  const visible = filterAuthoringEntries(allEntries, query, category, activeRegistry);
  const label = isSnippet ? "snippet" : "math shortcut";
  const personalCount = allEntries.filter((entry) => !entry.built_in).length;

  function renderCard(entry: AuthoringEntry): JSX.Element {
    const actions = entry.built_in ? null : (
      <div className="authoring-entry-actions">
        <button type="button" className="button" onClick={() => beginEntryForm(entry, activeRegistry)}>
          Edit
        </button>
        <button type="button" className="button authoring-delete" onClick={() => requestDeletion(entry, activeRegistry)}>
          Delete
        </button>
      </div>
    );
    if (!isSnippet) {
      const math = entry as MathShortcutEntry;
      return (
        <article key={String(entry.id)} className="math-shortcut-card settings-card authoring-entry-card rounded-2xl border p-4">
          <div className="math-shortcut-heading flex items-start justify-between gap-3 authoring-entry-card-heading">
            <div className="min-w-0">
              <p className="math-shortcut-alias">{entryLabel(entry, activeRegistry)}</p>
              <h3 className="mt-1 text-xl font-bold">{entry.name || "Untitled"}</h3>
              <p className="mt-1 text-sm">{entry.description || ""}</p>
            </div>
            <span className="snippet-origin-badge authoring-entry-badge">{entry.built_in ? "Built-in" : "Personal"}</span>
          </div>
          <div className="math-shortcut-card-example mt-4">
            <p className="snippet-example-label mb-2">Example</p>
            <ExamplePreview source={`$${mathExample(math.expansion)}$`} renderExample={renderExample} />
          </div>
          {actions}
        </article>
      );
    }
    const snippet = entry as SnippetEntry;
    return (
      <article key={String(entry.id)} className="snippet-card library-card authoring-entry-card rounded-2xl border p-5">
        <div className="flex items-start justify-between gap-4 authoring-entry-card-heading">
          <div className="min-w-0">
            <p className="snippet-category-badge">{snippet.category === "Elef DSL" ? "Elef directives" : snippet.category}</p>
            <h3 className="mt-1 text-2xl font-bold">{entry.name || "Untitled"}</h3>
            <p className="mt-1">{`${entryLabel(entry, activeRegistry)} · ${entry.description || ""}`}</p>
          </div>
          <span className="snippet-origin-badge authoring-entry-badge">{entry.built_in ? "Built-in" : "Personal"}</span>
        </div>
        <div className="snippet-example mt-4">
          <p className="snippet-example-label">Template</p>
          <pre className="snippet-template overflow-auto rounded-xl p-3 text-sm">
            <code>{snippet.body || ""}</code>
          </pre>
          <p className="snippet-example-label mt-3">Example</p>
          <ExamplePreview source={snippetExample(snippet.body)} renderExample={renderExample} />
        </div>
        {actions}
      </article>
    );
  }

  return (
    <section aria-label="Authoring settings" className="authoring-settings">
      <p id="authoring-settings-status" className="authoring-settings-status" role="status" aria-live="polite">
        {status}
      </p>
      <div role="tablist" aria-label="Authoring registries">
        {(["snippets", "math_shortcuts"] as const).map((registry) => (
          <button
            key={registry}
            type="button"
            role="tab"
            aria-selected={registry === activeRegistry}
            data-authoring-tab={registry}
            className={registry === activeRegistry ? "is-active" : ""}
            onClick={() => {
              setActiveRegistry(registry);
              setFormOpen(false);
              setStatus("");
            }}
          >
            {registry === "snippets" ? "Snippets" : "Math shortcuts"}
          </button>
        ))}
      </div>
      <h2 id="authoring-settings-title">{isSnippet ? "Snippets" : "Math shortcuts"}</h2>
      <p id="authoring-settings-count" className="dialog-copy">
        {`${allEntries.length} ${label}${allEntries.length === 1 ? "" : "s"} · ${personalCount} personal`}
      </p>
      <button type="button" onClick={() => beginEntryForm(null, activeRegistry)}>
        {isSnippet ? "New snippet" : "New shortcut"}
      </button>
      <input
        id="authoring-settings-search"
        type="search"
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
        aria-label="Search entries"
      />
      {isSnippet ? (
        <select id="authoring-settings-category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {SNIPPET_CATEGORIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
      <div id="authoring-settings-list" className="authoring-settings-list" aria-live="polite">
        {visible.length === 0 ? (
          <p id="authoring-settings-empty">{query || category ? "No entries match this search." : "No entries are available."}</p>
        ) : null}
        {visible.map(renderCard)}
      </div>
      {formOpen ? (
        <form id="authoring-entry-form" className="authoring-entry-form" onSubmit={(event) => void saveEntry(event)}>
          <h3>{editingId ? `Edit ${isSnippet ? "snippet" : "shortcut"}` : `New ${isSnippet ? "snippet" : "shortcut"}`}</h3>
          <input type="hidden" name="id" value={editingId || ""} />
          <label>
            Name
            <input type="text" name={isSnippet ? "name" : "math-name"} value={fields.name} onInput={(event) => setFields({ ...fields, name: event.currentTarget.value })} />
          </label>
          <label>
            Description
            <input
              type="text"
              name={isSnippet ? "description" : "math-description"}
              value={fields.description}
              onInput={(event) => setFields({ ...fields, description: event.currentTarget.value })}
            />
          </label>
          {isSnippet ? (
            <>
              <label>
                Trigger
                <input type="text" name="trigger" value={fields.trigger} onInput={(event) => setFields({ ...fields, trigger: event.currentTarget.value })} />
              </label>
              <label>
                Category
                <select name="category" value={fields.category} onChange={(event) => setFields({ ...fields, category: event.target.value })}>
                  {SNIPPET_CATEGORIES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Template
                <textarea name="body" value={fields.body} onInput={(event) => setFields({ ...fields, body: event.currentTarget.value })} />
              </label>
            </>
          ) : (
            <>
              <label>
                Prefix
                <select name="prefix" value={fields.prefix} onChange={(event) => setFields({ ...fields, prefix: event.target.value })}>
                  <option value=".">.</option>
                  <option value="@">@</option>
                </select>
              </label>
              <label>
                Aliases
                <input type="text" name="aliases" value={fields.aliases} onInput={(event) => setFields({ ...fields, aliases: event.currentTarget.value })} />
              </label>
              <label>
                Expansion
                <textarea name="expansion" value={fields.expansion} onInput={(event) => setFields({ ...fields, expansion: event.currentTarget.value })} />
              </label>
            </>
          )}
          <button id="save-authoring-entry" type="submit" disabled={writeInProgress}>
            Save {isSnippet ? "snippet" : "shortcut"}
          </button>
          <button type="button" onClick={() => setFormOpen(false)}>
            Cancel
          </button>
        </form>
      ) : null}
      {pendingDeletion ? (
        <div role="alertdialog" aria-labelledby="delete-authoring-title">
          <h2 id="delete-authoring-title">Delete personal entry?</h2>
          <p id="delete-authoring-message" className="dialog-copy">
            {`Delete “${String(pendingDeletion.entry.name || "this entry")}” from your authoring settings?`}
          </p>
          <button id="confirm-authoring-delete" type="button" onClick={() => void confirmDeletion()}>
            Delete
          </button>
          <button id="cancel-authoring-delete" type="button" onClick={() => setPendingDeletion(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}

// Re-exported for hosts that embed the dialog outside the settings page.
export type {
  AuthoringRegistries,
  AuthoringRegistryName,
  AuthoringRegistryTransport,
} from "./authoringRegistry.js";
