export type {
  EditorThemePreference,
  Presentation,
  PresentationTheme,
  Slide,
  ThemeMode,
} from './presentation';
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
  slideContentBudget,
  splitSlideMarkdown,
  upsertFirstH1,
} from './markdown';
export { hasUnsavedChanges } from './document';
