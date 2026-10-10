import type { DocumentEditorSeam } from "@elef/client"

export function editorFor(element: Element | null | undefined) {
  return element?.editorController || null
}

// Narrows a looked-up Stimulus controller to the document-editor seam the
// client consumes. The editor controller implements all four members, so a
// passing candidate is returned as-is (identity preserved); anything else —
// a missing controller or one without the seam — yields null instead of a
// lie. DocumentEditorSeam also satisfies PresentationEditorSeam, so this one
// guard serves both client editors.
export function asEditorSeam(candidate: unknown): DocumentEditorSeam | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const seam = candidate as Record<string, unknown>
  if (typeof seam.value !== "string") return null
  if (typeof seam.commitSource !== "function") return null
  if (typeof seam.replaceRange !== "function") return null
  if (typeof seam.replaceRanges !== "function") return null
  return candidate as DocumentEditorSeam
}
