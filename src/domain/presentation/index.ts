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
  normalizeFolderName,
  parseMarkdown,
  presentationThemeFromSource,
  replaceSlideMarkdown,
  setPresentationTheme,
  splitSlideMarkdown,
  upsertFirstH1,
} from './markdown';
export { hasUnsavedChanges } from './document';
