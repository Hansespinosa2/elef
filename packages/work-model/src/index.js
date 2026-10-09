// Barrel uses self-referential bare specifiers (never relative imports) so
// the browser can load this file through the importmap, which does not
// rewrite relative module specifiers. Node and esbuild resolve the same
// specifiers through the package exports map.
export {
  buildEditorMap,
  buildEditorStructure,
  frontMatterHasKey,
  initialFrontMatter,
  normalizeThemeValue,
  normalizeTypographyValue,
  readStyle,
  readStyleOverrides,
  replaceFirstHeading,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
} from "@elef/work-model/document-map"
export {
  addSlide,
  blockOperationStart,
  deleteSlide,
  directiveLineSpan,
  exciseRanges,
  expandSnippet,
  insertAlignDirective,
  insertBlock,
  mediaInsertText,
  moveBlock,
  moveSlide,
  parseAlignment,
  removeBlock
} from "@elef/work-model/document-transforms"
export {
  buildDocumentGraph,
  createDocumentLinkResolver,
  extractDocumentLinkTitles,
  extractDocumentLinkTokens,
  extractFirstMarkdownHeading,
  isLinkableDocumentTitle,
  linkableDocumentTitles,
  parseDocumentLinkAt,
  parsePortableDocumentLinks
} from "@elef/work-model/document-links"
