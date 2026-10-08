// Shared authoring-registry semantics: snippets and math shortcuts the user
// owns. Pure entry validation/building, ordering, search filtering and the
// write handshake live here so every host dialog behaves identically; only
// the persistence transport differs per host (injected, never branched on).

export type AuthoringRegistryName = "snippets" | "math_shortcuts";

export interface SnippetEntry {
  readonly id: string | number;
  readonly name: string;
  readonly trigger: string;
  readonly description?: string;
  readonly category: string;
  readonly body: string;
  readonly built_in?: boolean;
}

export interface MathShortcutEntry {
  readonly id: string | number;
  readonly name: string;
  readonly prefix: string;
  readonly aliases: readonly string[];
  readonly description?: string;
  readonly expansion: string;
  readonly built_in?: boolean;
}

export type AuthoringEntry = SnippetEntry | MathShortcutEntry;

export interface AuthoringRegistries {
  readonly snippets: readonly SnippetEntry[];
  readonly math_shortcuts: readonly MathShortcutEntry[];
}

export interface AuthoringRegistryTransport {
  readRegistries(): Promise<{
    snippets?: readonly SnippetEntry[];
    math_shortcuts?: readonly MathShortcutEntry[];
    hashes?: { snippets?: string | null; math_shortcuts?: string | null } | null;
  }>;
  writeRegistry(input: {
    registry: AuthoringRegistryName;
    entries: readonly AuthoringEntry[];
    baseHash?: string | null;
  }): Promise<{ entries?: readonly AuthoringEntry[]; contentHash?: string | null }>;
}

const SNIPPET_CATEGORIES = new Set(["Markdown", "LaTeX", "Mermaid", "Elef DSL"]);
const MATH_ALIAS = /^(?:[A-Za-z][A-Za-z0-9_-]*|[0-9]|=)$/;

function requiredText(value: unknown, field: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) throw new TypeError(`Enter a ${field} of 1–${maxLength} characters.`);
  return text;
}

function optionalText(value: unknown, field: string, maxLength: number): string {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw new TypeError(`${field} must be at most ${maxLength} characters.`);
  return text;
}

function requiredContent(value: unknown, field: string, maxLength: number): string {
  const content = String(value ?? "");
  if (!content.trim() || content.length > maxLength) {
    throw new TypeError(`Enter ${field} with 1–${maxLength} characters.`);
  }
  return content;
}

export interface SnippetFields {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly trigger?: unknown;
  readonly category?: unknown;
  readonly body?: unknown;
}

export interface MathShortcutFields {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly prefix?: unknown;
  readonly aliases?: unknown;
  readonly expansion?: unknown;
}

export function buildAuthoringEntry(
  registry: "snippets",
  fields: SnippetFields,
  id: string,
): SnippetEntry;
export function buildAuthoringEntry(
  registry: "math_shortcuts",
  fields: MathShortcutFields,
  id: string,
): MathShortcutEntry;
export function buildAuthoringEntry(
  registry: AuthoringRegistryName,
  fields: SnippetFields & MathShortcutFields,
  id: string,
): AuthoringEntry {
  const common = {
    id: requiredText(id, "entry ID", 200),
    name: requiredText(fields.name, "name", 120),
    description: optionalText(fields.description, "description", 500),
    built_in: false as const,
  };

  if (registry === "snippets") {
    const trigger = requiredText(fields.trigger, "trigger", 120);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(trigger)) {
      throw new TypeError("Snippet triggers must use lowercase letters, numbers, and hyphens.");
    }
    const category = requiredText(fields.category, "category", 80);
    if (!SNIPPET_CATEGORIES.has(category)) throw new TypeError("Choose a supported snippet category.");
    return { ...common, trigger, category, body: requiredContent(fields.body, "a snippet body", 20_000) };
  }

  if (registry === "math_shortcuts") {
    const prefix = String(fields.prefix ?? "");
    if (![".", "@"].includes(prefix)) throw new TypeError("Choose a supported math shortcut prefix.");
    const aliases = [
      ...new Set(
        String(fields.aliases ?? "")
          .split(/[\s,]+/)
          .map((alias) => alias.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (
      !aliases.length ||
      aliases.length > 100 ||
      aliases.some((alias) => alias.length > 120 || !MATH_ALIAS.test(alias))
    ) {
      throw new TypeError("Enter one or more valid aliases separated by commas.");
    }
    return { ...common, prefix, aliases, expansion: requiredContent(fields.expansion, "an expansion", 20_000) };
  }

  throw new TypeError("Choose a supported authoring registry.");
}

export function upsertAuthoringEntry<TEntry extends AuthoringEntry>(
  entries: readonly TEntry[],
  entry: TEntry,
): TEntry[] {
  return [...entries.filter((existing) => String(existing.id) !== String(entry.id)), entry];
}

export function removeAuthoringEntry<TEntry extends AuthoringEntry>(
  entries: readonly TEntry[],
  id: string | number,
): TEntry[] {
  return entries.filter((entry) => String(entry.id) !== String(id));
}

const CATEGORY_ORDER = new Map([["Markdown", 0], ["LaTeX", 1], ["Mermaid", 2], ["Elef DSL", 3]]);

function compareText(left: unknown, right: unknown): number {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedEntries<TEntry extends AuthoringEntry>(
  entries: readonly TEntry[],
  registry: AuthoringRegistryName,
): TEntry[] {
  return [...entries].sort((left, right) => {
    if (registry === "snippets") {
      const category =
        (CATEGORY_ORDER.get((left as SnippetEntry).category) ?? 4) -
        (CATEGORY_ORDER.get((right as SnippetEntry).category) ?? 4);
      if (category) return category;
    }
    return compareText(left.name, right.name) || compareText(left.id, right.id);
  });
}

export function filterAuthoringEntries<TEntry extends AuthoringEntry>(
  entries: readonly TEntry[],
  query: string,
  category: string,
  registry: AuthoringRegistryName,
): TEntry[] {
  const needle = query.trim().toLowerCase();
  return sortedEntries(entries, registry).filter((entry) => {
    if (registry === "snippets" && category && (entry as SnippetEntry).category !== category) return false;
    if (!needle) return true;
    const searchable = [
      entry.name,
      (entry as Partial<SnippetEntry>).trigger,
      (entry as Partial<SnippetEntry>).category,
      entry.description,
      (entry as Partial<SnippetEntry>).body,
      (entry as Partial<MathShortcutEntry>).expansion,
      ...((entry as Partial<MathShortcutEntry>).aliases || []),
    ]
      .join(" ")
      .toLowerCase();
    return searchable.includes(needle);
  });
}

export function snippetExample(body: string): string {
  return String(body || "").replace(/\$\{\d+(?::([^}]*))?\}/g, (_match, label) => label || "example");
}

export function mathExample(expansion: string): string {
  return String(expansion || "").replace(/\$\{\d+(?::[^}]*)?\}/g, "x");
}

export function entryLabel(entry: AuthoringEntry, registry: AuthoringRegistryName): string {
  if (registry === "math_shortcuts") {
    const math = entry as MathShortcutEntry;
    return `${math.prefix || "@"}${(math.aliases || []).join(", ")}`;
  }
  const snippet = entry as SnippetEntry;
  return `${snippet.category === "Elef DSL" ? ":" : "/"}${snippet.trigger || ""}`;
}

export interface AuthoringWriteResult {
  readonly ok: boolean;
}

export async function writeAuthoringRegistry(input: {
  registry: AuthoringRegistryName;
  entries: readonly AuthoringEntry[];
  baseHash?: string | null;
  writeRegistry: AuthoringRegistryTransport["writeRegistry"];
  updateLocal: (saved: { entries: readonly AuthoringEntry[]; contentHash?: string | null }) => void;
  reloadEditorRegistry: () => Promise<void>;
}): Promise<AuthoringWriteResult> {
  const result = await input.writeRegistry({
    registry: input.registry,
    entries: input.entries,
    baseHash: input.baseHash ?? null,
  });
  input.updateLocal({ entries: result.entries || input.entries, contentHash: result.contentHash ?? null });
  await input.reloadEditorRegistry();
  return { ok: true };
}

export function authoringFailureMessage(error: { code?: string } | null, registry: AuthoringRegistryName): string {
  const label = registry === "snippets" ? "Snippet" : "Math shortcut";
  if (error?.code === "conflict") {
    return `${label} settings changed outside Elef. Close and reopen settings to load the latest entries before saving.`;
  }
  if (error?.code === "invalid_input") {
    return "These settings are invalid. Check the name, trigger, category, aliases, and template.";
  }
  return "Could not save authoring settings. Check that the settings store is writable.";
}
