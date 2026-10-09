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

// Field-by-field list identity for the reload bailout: a refresh that
// leaves every displayed field untouched keeps the previous array so React
// skips the commit entirely. Order-sensitive on purpose — a reorder is a
// visible change even when the members match.
export function sameWorks(a: readonly WorkSummary[], b: readonly WorkSummary[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((work, index) => {
    const other: WorkSummary | undefined = b[index];
    if (other === undefined) return false;
    return (
      work.id === other.id &&
      work.workspaceId === other.workspaceId &&
      work.title === other.title &&
      work.kind === other.kind &&
      (work.updatedAt ?? null) === (other.updatedAt ?? null) &&
      (work.warnings ?? []).join("\n") === (other.warnings ?? []).join("\n")
    );
  });
}
