// Quiet-save title follow: after a session save adopts the source's first
// "# h1" as the work's folder name (desktop host), the open work's shell
// surfaces must mirror the adopted name at once. The title input mirror is
// load-bearing: the title save flow reads the input as a pending manual
// edit, so a stale input renames the work back on the next flush. Hosts
// without the follow hook (web) skip everything and keep the save result.
//
// The native quit flush suspends the follow: quitting guarantees byte
// preservation at the work's path (the committed native-quit contract), and
// silently reorganizing the user's folders on the way out — with no live UI
// left to show the new title — is wrong. An explicit title-field edit still
// applies on quit through the title save flow; only the inferred H1 rename
// is suppressed.
let suspended = false

export function suspendHeadingTitleFollow(): void {
  suspended = true
}

export function resumeHeadingTitleFollow(): void {
  suspended = false
}

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
  if (suspended) return null
  let name: string | null = null
  try {
    const follow = (host as { followHeadingTitle?: unknown } | null | undefined)?.followHeadingTitle
    if (typeof follow === "function") name = (await follow.call(host, workFolderId, source)) ?? null
  } catch {
    name = null
  }
  if (typeof name !== "string" || name.length === 0) return null
  const folder = shell.folders.find(workFolder => workFolder.id === workFolderId)
  if (folder) folder.name = name
  if (shell.active && shell.active.id === workFolderId) {
    shell.active.name = name
    shell.setWorkTitle(name)
    shell.setBreadcrumb(name)
    shell.setTitleInput(name)
  }
  return name
}
