import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { buildEditorMap, buildEditorStructure, withAppearanceValue } from "./document_map.js"
import { renderLibraryCard } from "./library_card.js"
import { buildDocumentGraph } from "./document_links.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
  buildEditorMap,
  buildEditorStructure,
  renderLibraryCard,
  buildDocumentGraph,
  withAppearanceValue
})
