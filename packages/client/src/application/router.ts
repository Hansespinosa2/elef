import type { LibraryFilter } from "./types.js";

export interface LibraryRoute {
  readonly filter: LibraryFilter;
}

const FILTER_PATHS: Readonly<Record<string, LibraryFilter>> = {
  "/": "all",
  "/documents": "documents",
  "/presentations": "presentations",
};

export function parseLibraryRoute(url: string): LibraryRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "elef://localhost");
  } catch {
    return null;
  }
  // The client's own tab hrefs are hash routes; hosts with real paths
  // (Rails) match on the pathname instead.
  const hash = /^#library\/([a-z]+)\/?$/.exec(parsed.hash);
  if (hash !== null) {
    const viaHash = FILTER_PATHS[`/${hash[1]}`];
    if (viaHash !== undefined) return { filter: viaHash };
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const filter = FILTER_PATHS[path];
  return filter === undefined ? null : { filter };
}
