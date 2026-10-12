// Swallow file drops outside the shared editor surfaces.
//
// The Tauri window disables the native drag-and-drop handler
// (dragDropEnabled in tauri.conf.json) so OS file drops reach the DOM and the
// shared media controller owns drops on the editor surfaces exactly like on
// web. Anywhere else, an unhandled file drop would navigate this chromeless
// webview to a file:// URL and strand the app with no way back, so this host
// adapter prevents the default there. Drops on the editor surfaces pass
// through untouched for the shared controller.
const EDITOR_DROP_SURFACES = ".editor-surface, .editor-projection"

export function isEditorSurfaceDropTarget(target) {
  return Boolean(target?.closest?.(EDITOR_DROP_SURFACES))
}

export function installDesktopDropGuard(target = globalThis.window) {
  const onDrop = event => {
    if (!event || isEditorSurfaceDropTarget(event.target)) return
    event.preventDefault()
  }
  target?.addEventListener?.("drop", onDrop, true)
  return () => target?.removeEventListener?.("drop", onDrop, true)
}
