// Barrel uses self-referential bare specifiers (never relative imports) so
// the browser can load the built dist entry through the importmap, which does
// not rewrite relative module specifiers. Node and esbuild resolve the same
// specifiers through the package exports map.
export {
  buildEditorMap,
  buildEditorStructure,
  frontMatterHasKey,
  initialFrontMatter,
  normalizeThemeValue,
  normalizeTypographyValue,
  POSITION_VOCABULARY,
  presentationTheme,
  PRESENTATION_THEMES,
  readStyle,
  readStyleOverrides,
  replaceFirstHeading,
  sourceAnchorLines,
  withAppearanceValue,
  withFrontMatterValue
} from "@elef/work-model/document-map"
export type {
  EditorMap,
  EditorStructure,
  EditorStyle,
  FrontMatter,
  MapArtDiagnostic,
  MapBlock,
  MapBlockArt,
  MapDirective,
  MapRegion,
  MapSlide,
  MarginSettings,
  ParsedBlock,
  ParsedSlide,
  PresentationTheme,
  SlideMetadata,
  SourceLine,
  SourcePosition,
  SourceRange
} from "@elef/work-model/document-map"
export {
  addSlide,
  blockOperationRange,
  blockOperationStart,
  deleteSlide,
  directiveLineSpan,
  exciseRange,
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
export type {
  AlignInsertion,
  Alignment,
  BlockOperationSpan,
  CaretRange,
  DirectiveLineSpan,
  RangeExcision,
  SnippetExpansion,
  SnippetStop,
  TransformBlock,
  TransformDirective,
  TransformMap,
  TransformRange,
  TransformSlide
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
export type {
  DocumentGraph,
  DocumentGraphEdge,
  DocumentGraphNode,
  DocumentLinkToken,
  LinkableDocument,
  PortableDocumentLinks,
  ResolvedDocument
} from "@elef/work-model/document-links"
export {
  analyzeArtList,
  ART_DIAGNOSTICS,
  markdownBoundaryMap,
  resolveArtBindings
} from "@elef/work-model/art-source"
export type {
  ArtBinding,
  ArtBindings,
  ArtBoundaryMap,
  ArtDiagnostic,
  ArtDiagnosticCode,
  ArtDirective,
  ArtListAnalysis,
  ArtListRange,
  ArtSourceRange,
  ArtTargetLines
} from "@elef/work-model/art-source"
export {
  NON_TRAILING_BOTTOM_WARNING,
  slidePositionClasses,
  slidePositionLayout
} from "@elef/work-model/slide-position-layout"
export type {
  SlideBlockEntry,
  SlideBottomEntry,
  SlideMiddleEntry,
  SlidePositionBlock,
  SlidePositionEntry,
  SlidePositionLayout
} from "@elef/work-model/slide-position-layout"
