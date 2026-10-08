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
  let path: string;
  try {
    path = new URL(url, "elef://localhost").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
  const filter = FILTER_PATHS[path];
  return filter === undefined ? null : { filter };
}
