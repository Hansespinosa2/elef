import { collectMediaReferences, renderMarkdownBlock as renderMarkdownBlockCore, renderPreviewCore } from "@elef/renderer"
import type { MarkdownBlockOptions, RenderPreviewInput } from "@elef/renderer"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"

// The shipped bundle composes bare projection with editor chrome so every
// consumer (MiniRacer, workers, importmap) keeps byte-identical output.
const renderPreview = (input?: RenderPreviewInput) => renderPreviewCore(input, { chrome: editorChrome })
const renderMarkdownBlock = (source?: string, options?: MarkdownBlockOptions) => renderMarkdownBlockCore(source, { ...options, chrome: editorChrome })
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

declare global {
  // Bundle seam for MiniRacer, workers and importmap consumers: untyped by
  // design, since only JS/Ruby read it. TypeScript consumers import the
  // package entries instead.
  var ElefRenderer: unknown
}

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
