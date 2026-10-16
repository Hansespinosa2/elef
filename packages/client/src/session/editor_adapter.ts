// Editor-adapter interface for the session (Phase 08).
//
// The session owns text; it reaches the screen only through the adapter the
// host binds. The adapter is the narrow CodeMirror seam: a second,
// non-CodeMirror adapter (ProseMirror, TipTap) implements this same surface
// later without touching session logic.
//
// Interface:
//   getText() -> string                     current buffer text
//   setText(source, meta) -> boolean|Promise<boolean>
//     apply an authorized source replacement (external change, conflict
//     resolution, structural op); meta carries { id, expectedSource } and
//     the adapter must refuse stale targets exactly like applyEditorSource.
//   materializeEdits()                      flush pending projection edits
//     into the buffer before any read or write.
//
// Binding rule: exactly one live adapter per session. The session validates
// the shape at construction (assertEditorAdapter) and carries identity
// (workId + epoch) with a disposed flag, so hosts bind one session per open
// work and commit paths can refuse stale sessions.
export const ADAPTER_METHODS = ["getText", "setText", "materializeEdits"]

export interface EditorAdapterSetMeta {
  id: string
  expectedSource: string
  preserveMetadata?: boolean
}

export interface EditorAdapter {
  getText(): string
  setText(source: string, meta: EditorAdapterSetMeta): boolean | Promise<boolean>
  materializeEdits(): void
}

export function assertEditorAdapter(adapter: unknown): EditorAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("Session policy requires an editor adapter object.")
  }
  for (const method of ADAPTER_METHODS) {
    if (typeof (adapter as Record<string, unknown>)[method] !== "function") {
      throw new TypeError(`Session editor adapter requires ${method}().`)
    }
  }
  return adapter as EditorAdapter
}
