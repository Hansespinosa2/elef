import type { LibraryFilter } from "./types.js";
import type { WorkKind } from "@elef/contracts";

export interface LibraryRoute {
  readonly filter: LibraryFilter;
}

const FILTER_PATHS: Readonly<Record<string, LibraryFilter>> = {
  "/": "all",
  "/documents": "documents",
  "/presentations": "presentations",
};

import type { AuthoringRegistryName } from "../features/settings/authoringRegistry.js";

export type SettingsRoute =
  | { readonly kind: "defaults" }
  | {
      readonly kind: "authoring";
      readonly registry: AuthoringRegistryName;
      readonly openNew: boolean;
      readonly entryId: string | null;
    };

// Workspace settings (defaults form) plus the authoring-registry pages. The
// pre-migration hosts serve these as separate server-rendered pages
// (/settings, /snippets[/new|/:id/edit], /math_shortcuts[/new|/:id/edit]);
// the client mounts the matching shared UI for all of them.
export function parseSettingsRoute(url: string): SettingsRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "elef://localhost");
  } catch {
    return null;
  }
  const hash = /^#(settings|snippets|math_shortcuts)(\/.*)?$/.exec(parsed.hash);
  const path = hash !== null ? `/${hash[1]}${hash[2] || ""}` : parsed.pathname;
  const segments = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0] === "settings" && segments.length === 1) return { kind: "defaults" };
  const registry: AuthoringRegistryName | null =
    segments[0] === "snippets" ? "snippets" : segments[0] === "math_shortcuts" ? "math_shortcuts" : null;
  if (registry === null) return null;
  if (segments.length === 1) return { kind: "authoring", registry, openNew: false, entryId: null };
  if (segments[1] === "new" && segments.length === 2) {
    return { kind: "authoring", registry, openNew: true, entryId: null };
  }
  if (segments.length === 3 && segments[2] === "edit" && typeof segments[1] === "string") {
    return { kind: "authoring", registry, openNew: false, entryId: segments[1] };
  }
  return null;
}

export function isSettingsRoute(url: string): boolean {
  return parseSettingsRoute(url) !== null;
}

export type WorkView = "new" | "edit" | "show" | "present" | "print" | "history";

export interface WorkRoute {
  readonly kind: WorkKind;
  readonly id: string | null;
  readonly view: WorkView;
}

const WORK_SEGMENTS: Readonly<Record<string, WorkKind>> = {
  documents: "document",
  presentations: "presentation",
};

// Product work links: authoring entries (new/edit) resolve through the
// shell/editor stack on both hosts, while read/publish entries (show,
// present, print, history) are web-only pages. Desktop maps work targets to
// openDeck instead of URLs.
export function parseWorkRoute(url: string): WorkRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "elef://localhost");
  } catch {
    return null;
  }
  const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const kind = WORK_SEGMENTS[segments[0] ?? ""];
  if (kind === undefined) return null;
  if (segments.length === 2 && segments[1] === "new") {
    return { kind, id: null, view: "new" };
  }
  if (segments.length < 2 || segments[1] === "") return null;
  const id = segments[1] as string;
  if (segments.length === 2) return { kind, id, view: "show" };
  if (segments.length === 3) {
    const view = segments[2];
    if (
      view === "edit" ||
      view === "present" ||
      view === "print" ||
      view === "history"
    ) {
      return { kind, id, view };
    }
  }
  return null;
}

export function isWorkRoute(url: string): boolean {
  return parseWorkRoute(url) !== null;
}

export function parseLibraryRoute(url: string): LibraryRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "elef://localhost");
  } catch {
    return null;
  }
  // The client's own tab hrefs are hash routes; hosts with real paths
  // match on the pathname instead.
  const hash = /^#library\/([a-z]+)\/?$/.exec(parsed.hash);
  if (hash !== null) {
    const viaHash = FILTER_PATHS[`/${hash[1]}`];
    if (viaHash !== undefined) return { filter: viaHash };
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const filter = FILTER_PATHS[path];
  return filter === undefined ? null : { filter };
}
