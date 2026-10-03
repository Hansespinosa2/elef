import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { buildEditorMap, buildEditorStructure } from "./document-map.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
  buildEditorMap,
  buildEditorStructure
})
