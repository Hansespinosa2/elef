export type {
  EditorThemePreference,
  Presentation,
  PresentationTheme,
  Slide,
  SlideLayout,
  ThemeMode,
} from './presentation';
export type { SlideSourceRange } from './markdown';
export {
  normalizeEditorThemePreference,
  resolveEditorTheme,
  resolvePresentationTheme,
} from './presentation';
export {
  extractFirstH1,
  deleteSlideMarkdown,
  insertSlideMarkdown,
  isSlideOverBudget,
  normalizeFolderName,
  parseMarkdown,
  presentationThemeFromSource,
  replaceSlideMarkdown,
  setPresentationTheme,
  slideSourceRanges,
  slideContentBudget,
  splitSlideAtSeparator,
  splitSlideMarkdown,
  upsertFirstH1,
} from './markdown';
export { hasUnsavedChanges } from './document';
