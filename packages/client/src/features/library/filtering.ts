import type { WorkSummary } from "@elef/contracts";
import type { LibraryFilter } from "../../application/types.js";

export function normalizeLibrarySearch(value: unknown): string {
  return String(value ?? "").trim().normalize("NFC").toLowerCase();
}

export function libraryNameMatches(name: string, query: string): boolean {
  const needle = normalizeLibrarySearch(query);
  return needle === "" || normalizeLibrarySearch(name).includes(needle);
}

export function filterWorks(
  works: readonly WorkSummary[],
  filter: LibraryFilter,
  query = "",
): WorkSummary[] {
  const kind = filter === "documents" ? "document" : filter === "presentations" ? "presentation" : null;
  return works.filter((work) => {
    if (kind !== null && work.kind !== kind) return false;
    return libraryNameMatches(work.title, query);
  });
}
