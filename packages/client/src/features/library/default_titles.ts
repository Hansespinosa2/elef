import type { WorkKind } from "@elef/contracts";

// Base titles mirror the server defaults: Document.available_default_source
// seeds "Untitled document" and Work#default_title covers both kinds.
const BASE_TITLES: Record<WorkKind, string> = {
  document: "Untitled document",
  presentation: "Untitled presentation",
};

// First free "Untitled <kind>" title, counting up exactly like
// Document.available_default_source (bare base first, then " 2", " 3", ...).
// Comparison is case-insensitive over NFC-normalized names: the desktop
// backend rejects case-folded collisions (local-store normalized_name), so a
// case-sensitive check could hand back a name the host refuses. Finer
// fold differences (e.g. ß/ss) and double-submit races stay on the host
// error-notice path, same as any other failed create.
export function nextDefaultWorkTitle(kind: WorkKind, existingTitles: Iterable<string>): string {
  const base = BASE_TITLES[kind];
  const taken = new Set<string>();
  for (const title of existingTitles) taken.add(foldTitle(title));
  if (!taken.has(foldTitle(base))) return base;
  let suffix = 2;
  while (taken.has(foldTitle(`${base} ${suffix}`))) suffix += 1;
  return `${base} ${suffix}`;
}

// True for the generated untitled names (bare, numbered, either kind):
// the only titles the H1 follow may adopt. A named work keeps its folder
// name no matter what its heading says; only an explicit card or title
// rename moves it.
export function isDefaultWorkTitle(title: unknown): boolean {
  if (typeof title !== "string") return false;
  const bare = title.normalize("NFC").trim();
  if (bare.length === 0) return true;
  return /^untitled( document| presentation)?( \d+)?$/i.test(bare);
}

function foldTitle(value: string): string {
  return value.normalize("NFC").toLowerCase();
}
