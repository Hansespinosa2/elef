// Swallow file drops outside the shared editor surfaces.
//
// The Tauri window disables the native drag-and-drop handler
// (dragDropEnabled in tauri.conf.json) so OS file drops reach the DOM and the
// shared media controller owns drops on the editor surfaces exactly like on
// web. Anywhere else, an unhandled file drop would navigate this chromeless
// webview to a file:// URL and strand the app with no way back, so this host
// adapter cancels the drag there. Drops on the editor surfaces pass through
// untouched for the shared controller.
//
// Both listeners are load-bearing: per the HTML drag-and-drop contract a drop
// event only dispatches where dragover was cancelled, so a drop-only guard
// could never fire outside the editor surfaces (which cancel dragover
// themselves for the shared controller). Both are also scoped to file drags
// only, so dragging text into title/settings inputs keeps working.
const EDITOR_DROP_SURFACES = ".editor-surface, .editor-projection"

export function isEditorSurfaceDropTarget(target) {
  return Boolean(target?.closest?.(EDITOR_DROP_SURFACES))
}

export function isFileDrag(event) {
  const types = event?.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes("Files")
}

export function installDesktopDropGuard(target = globalThis.window) {
  const onDragOver = event => {
    if (!event || isEditorSurfaceDropTarget(event.target)) return
    if (!isFileDrag(event)) return
    event.preventDefault()
  }
  const onDrop = event => {
    if (!event || isEditorSurfaceDropTarget(event.target)) return
    if (!isFileDrag(event)) return
    event.preventDefault()
  }
  target?.addEventListener?.("dragover", onDragOver, true)
  target?.addEventListener?.("drop", onDrop, true)
  return () => {
    target?.removeEventListener?.("dragover", onDragOver, true)
    target?.removeEventListener?.("drop", onDrop, true)
  }
}
