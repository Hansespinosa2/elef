export interface Slide {
  id: string;
  index: number;
  markdown: string;
}

export type ThemeMode = 'light' | 'dark';
export type EditorThemePreference = 'system' | ThemeMode;
export type PresentationTheme = 'match' | ThemeMode;

export interface Presentation {
  sourceName: string;
  presentationTheme: PresentationTheme;
  slides: Slide[];
}

export function normalizeEditorThemePreference(value: string | null): EditorThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveEditorTheme(
  preference: EditorThemePreference,
  systemPrefersDark: boolean,
): ThemeMode {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

export function resolvePresentationTheme(
  presentationTheme: PresentationTheme,
  editorTheme: ThemeMode,
): ThemeMode {
  return presentationTheme === 'match' ? editorTheme : presentationTheme;
}
