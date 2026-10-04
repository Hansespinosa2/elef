import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { buildEditorMap, buildEditorStructure, withAppearanceValue } from "./document_map.js"
import { renderLibraryCard } from "./library_card.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
  buildEditorMap,
  buildEditorStructure,
  renderLibraryCard,
  withAppearanceValue
})
