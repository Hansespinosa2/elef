// Bundle entry for apps/web/script/build_renderer.mjs. Build-owned
// composition, not product code: it assembles the shipped
// elef-renderer.bundle.js (bare projection + editor chrome + work-model
// bridge) from workspace packages so every consumer (MiniRacer, workers,
// importmap) keeps byte-identical output. It supersedes the deleted
// apps/web/app/javascript/lib/renderer_global.js, whose composition it
// preserves statement-for-statement; only the chrome import moved with its
// module into @elef/editor-runtime. S4 (renderer home) relocates this entry
// into packages/renderer per ADR-007; until then the output path and the
// committed bytes stay put.
import { collectMediaReferences, renderMarkdownBlock as renderMarkdownBlockCore, renderPreviewCore } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"

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
