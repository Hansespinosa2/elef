import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { buildEditorMap, buildEditorStructure } from "./document-map.js"
import { renderLibraryCard } from "../../../app/javascript/lib/library_card.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
  buildEditorMap,
  buildEditorStructure,
  renderLibraryCard
})
