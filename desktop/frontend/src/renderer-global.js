import { collectMediaReferences, renderMarkdownBlock } from "./renderer.js"
import { buildEditorMap, buildEditorStructure } from "./document-map.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  buildEditorMap,
  buildEditorStructure
})
