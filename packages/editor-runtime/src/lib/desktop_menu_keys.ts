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
