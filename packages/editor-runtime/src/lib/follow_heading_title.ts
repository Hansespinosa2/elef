// Open-time H1 title adoption: when a work with no meaningful title yet
// (a generated "Untitled ..." name, or blank) is opened and its source
// already carries a first "# h1", the desktop host adopts the heading as
// the folder name so the library shows what the work is called.
//
// Scope is deliberate: a named work keeps its folder name no matter what
// its heading says — the editor source carries the H1 separately, and only
// an explicit card or title rename moves the folder (the committed
// shared-scenario contract: fixture paths and card captions stay stable
// across edits). Hosts without the follow hook (web) skip everything.
import { isDefaultWorkTitle } from "@elef/client"

export interface HeadingTitleShell {
  folders: { id: string; name: string }[];
  active: { id: string; name: string } | null;
  setWorkTitle(name: string): void;
  setBreadcrumb(name: string): void;
  setTitleInput(name: string): void;
}

export async function followHeadingTitleAfterSave(
  host: unknown,
  workFolderId: string,
  source: string,
  shell: HeadingTitleShell
): Promise<string | null> {
  const folder = shell.folders.find(workFolder => workFolder.id === workFolderId)
  const current = folder?.name ?? (shell.active && shell.active.id === workFolderId ? shell.active.name : null)
  // Only untitled works adopt: a named folder never moves implicitly.
  if (typeof current !== "string" || !isDefaultWorkTitle(current)) return null
  let name: string | null = null
  try {
    const follow = (host as { followHeadingTitle?: unknown } | null | undefined)?.followHeadingTitle
    if (typeof follow === "function") name = (await follow.call(host, workFolderId, source)) ?? null
  } catch {
    name = null
  }
  if (typeof name !== "string" || name.length === 0) return null
  if (folder) folder.name = name
  if (shell.active && shell.active.id === workFolderId) {
    shell.active.name = name
    shell.setWorkTitle(name)
    shell.setBreadcrumb(name)
    shell.setTitleInput(name)
  }
  return name
}
