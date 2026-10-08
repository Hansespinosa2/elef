import { collectMediaReferences, renderMarkdownBlock as renderMarkdownBlockCore, renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "./preview_chrome.js"

// The shipped bundle composes bare projection with editor chrome so every
// consumer (MiniRacer, workers, importmap) keeps byte-identical output.
const renderPreview = input => renderPreviewCore(input, { chrome: editorChrome })
const renderMarkdownBlock = (source, options) => renderMarkdownBlockCore(source, { ...options, chrome: editorChrome })
import {
  buildDocumentGraph,
  buildEditorMap,
  buildEditorStructure,
  extractDocumentLinkTokens,
  extractFirstMarkdownHeading,
  frontMatterHasKey,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  normalizeThemeValue,
  normalizeTypographyValue,
  parsePortableDocumentLinks,
  readStyle,
  readStyleOverrides,
  replaceFirstHeading,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
} from "@elef/work-model"

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderMarkdownBlock,
  renderPreview,
  buildEditorMap,
  buildEditorStructure,
  buildDocumentGraph,
  extractDocumentLinkTokens,
  extractFirstMarkdownHeading,
  frontMatterHasKey,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  normalizeThemeValue,
  normalizeTypographyValue,
  parsePortableDocumentLinks,
  readStyle,
  readStyleOverrides,
  replaceFirstHeading,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
})
