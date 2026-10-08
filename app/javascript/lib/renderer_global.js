import { collectMediaReferences, renderMarkdownBlock, renderPreview } from "./renderer.js"
import { renderLibraryCard, renderLibraryCardControls } from "./library_card.js"
import {
  buildDocumentGraph,
  buildEditorMap,
  buildEditorStructure,
  extractDocumentLinkTokens,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  withAppearanceValue
} from "@elef/work-model"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
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
