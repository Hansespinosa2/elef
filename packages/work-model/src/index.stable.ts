// Stable-profile barrel: every work-model slice except document links and
// the document graph (OQ-A4). The desktop Stable build resolves the bare
// "@elef/work-model" specifier to the dist entry built from here, so the
// Stable bundle cannot reference the link/graph modules even through the
// barrel; importing one fails the Stable editor-runtime build instead.
// Same self-referential-specifier rule as index.ts: never relative imports.
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
