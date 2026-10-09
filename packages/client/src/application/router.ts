import type { LibraryFilter } from "./types.js";

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
