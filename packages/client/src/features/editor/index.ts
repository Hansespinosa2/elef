import { EditorEngine } from "./engine.js"
export type { EditorEngine as EditorHandle } from "./engine.js"

export function mountEditor({ element }: { element: HTMLElement }): EditorEngine {
  const editor = new EditorEngine(element)
  editor.connect()
  return editor
}

export { createDocumentState } from "./document_state.js"
export { editorTabBinding, editorTabKeymap } from "./tab_keymap.js"
export { formatLineNumber } from "./line_numbers.js"
export { snippetStopsField, snippetStopsEffect } from "./snippet_stops.js"
export type { SnippetStop, SnippetStopsValue } from "./snippet_stops.js"
export { livePreviewField, livePreviewMode } from "./live_preview.js"
export { MERMAID_CONTAINER_SELECTOR, MERMAID_ERROR_CLASS, mermaidContainers, nextMermaidRenderId, mermaidAssetUrl, loadMermaid, mermaidConfig, renderMermaidDiagrams, renderMermaidSvg } from "./mermaid_runtime.js"
