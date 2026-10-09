import { collectMediaReferences, renderArtBlock, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { buildEditorMap, buildEditorStructure, withAppearanceValue } from "./document_map.js"
import { resolveArtBindings } from "./art_source.js"
import { renderLibraryCard, renderLibraryCardControls } from "./library_card.js"
import {
  buildDocumentGraph,
  extractDocumentLinkTokens,
  isLinkableDocumentTitle,
  linkableDocumentTitles
} from "./document_links.js"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderArtBlock,
  renderMarkdownBlock,
  renderPreview,
  resolveArtBindings,
  buildEditorMap,
  buildEditorStructure,
  renderLibraryCard,
  renderLibraryCardControls,
  buildDocumentGraph,
  extractDocumentLinkTokens,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  withAppearanceValue
})
