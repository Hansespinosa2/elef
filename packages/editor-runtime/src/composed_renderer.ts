import { collectMediaReferences, renderArtBlock, renderMarkdownBlock as renderMarkdownBlockCore, renderPreviewCore } from "@elef/renderer"
import type { MarkdownBlockOptions, RenderPreviewInput } from "@elef/renderer"
import { editorChrome } from "./preview_chrome.js"

// Editor-runtime-owned composition of bare projection with editor chrome,
// so every bundle consumer (MiniRacer, workers, importmap) keeps
// byte-identical output with the previous renderer-owned entry. Renderer
// entries stay bare (no editor-runtime import); this entry is the only
// place that composes chrome. Built self-contained (format-iife,
// external: []) for MiniRacer eval; see packages/editor-runtime/build.mjs.
const renderPreview = (input?: RenderPreviewInput) => renderPreviewCore(input, { chrome: editorChrome })
const renderMarkdownBlock = (source?: string, options?: MarkdownBlockOptions) => renderMarkdownBlockCore(source, { ...options, chrome: editorChrome })
// Bare core alongside the composed block render: export flows (notably the
// PPTX model builder) that must not carry editor chrome call this member.
// Any caller-passed chrome is dropped so the core falls back to bareChrome.
const renderMarkdownBlockBare = (source?: string, options?: MarkdownBlockOptions) => {
  const bareOptions = { ...options }
  delete bareOptions.chrome
  return renderMarkdownBlockCore(source, bareOptions)
}
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
  resolveArtBindings,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
} from "@elef/work-model"
import { slidePositionLayout } from "@elef/work-model/slide-position-layout"

declare global {
  // Bundle seam for MiniRacer, workers and importmap consumers: untyped by
  // design, since only JS/Ruby read it. TypeScript consumers import the
  // package entries instead.
  var ElefRenderer: unknown
}

globalThis.ElefRenderer = Object.freeze({
  collectMediaReferences,
  renderArtBlock,
  renderMarkdownBlock,
  renderMarkdownBlockBare,
  renderPreview,
  renderPreviewCore,
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
  resolveArtBindings,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue,
  slidePositionLayout
})
