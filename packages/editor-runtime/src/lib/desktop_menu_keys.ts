// Pure desktop webview key dispatch: which global Cmd chord the event
// carries, if any. Kept dependency-free (no DOM, no host APIs) so both the
// file-library application and plain node tests import it. Behavior mirror:
// - Cmd/Ctrl+K opens the shared palette in search mode (any shift/alt state,
//   exactly as before; the palette keeps the old search-first keyboard flow).
// - Cmd/Ctrl+Enter starts presentation (registry "present"; guarded: no
//   Shift/Alt/IME, so shifted variants keep their platform meaning).
export type DesktopMenuKeyAction = "focus-search" | "start-presentation"

export interface DesktopMenuKeyEvent {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly isComposing: boolean
}

export function desktopMenuKeyAction(event: DesktopMenuKeyEvent): DesktopMenuKeyAction | null {
  if (!(event.metaKey || event.ctrlKey)) return null
  const key = event.key.toLowerCase()
  if (key === "k") return "focus-search"
  if (key === "enter" && !event.shiftKey && !event.altKey && !event.isComposing) return "start-presentation"
  return null
}

// Palette surface state: the palette portals to document.body, so a hidden
// library view no longer gates it — ⌘K keeps its surface while editing. A
// live presentation (full-delivery surface) and an open modal host dialog (a
// plain div cannot paint above a modal dialog's top layer, so the palette
// would open invisibly and steal focus) still do.
export interface PaletteSurfaceState {
  readonly presenting: boolean
  readonly modalOpen: boolean
}

export function canOpenPalette(state: PaletteSurfaceState): boolean {
  return !state.presenting && !state.modalOpen
}
