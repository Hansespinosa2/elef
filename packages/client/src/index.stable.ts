// Stable-profile barrel: the full client surface except the slices the
// Stable desktop profile excludes (D1 true exclusion): the document graph
// (graph/*), the slide overview, the document visual editor, and the
// presentation visual editor. Presenting, source editing, library, export,
// settings, and sessions stay. The desktop Stable build resolves the bare
// "@elef/client" specifier to the dist entry built from here; importing an
// excluded export from the Stable editor-runtime build fails that build.
export { ADAPTER_METHODS, assertEditorAdapter } from "./session/editor_adapter.js";
export { createSaveFlow } from "./session/save_flow.js";
export { createTitleSaveFlow } from "./session/title_save_flow.js";
export { createWorkSession } from "./session/work_session.js";
export { createPortSession } from "./session/port_session.js";
export {
  caretAfterInsert,
  clampSelection,
  detectLineSeparator,
  diffSource,
  frontmatterRangeFor,
  normalizeLineEndings,
  offsetSelection,
  toEditorLineEndings,
} from "./session/source_ops.js";
export { mountElef } from "./application/shell.js";
export { isSettingsRoute, isWorkRoute, parseLibraryRoute, parseSettingsRoute, parseWorkRoute } from "./application/router.js";
export type { SettingsRoute, WorkRoute, WorkView } from "./application/router.js";
export { CREATE_WORK_EVENT } from "./features/library/LibraryApp.js";
export {
  PALETTE_ACTION_IDS,
  RESERVED_WEB_CHORDS,
  SHORTCUT_ACTIONS,
  chordDisplay,
  eventMatchesChord,
  shortcutById,
} from "./features/shortcuts/shortcuts.js";
export type { ShortcutAction, ShortcutChord, ShortcutKeyEvent } from "./features/shortcuts/shortcuts.js";
export { createPresentationNavigation, presentationActionForKey } from "./features/presentation/navigation.js";
export { attachCanvasScaling, PresentationController, mountPresentation } from "./features/presentation/presentation.js";
export { exportPptxModel, downloadBlob, dataUriToBlob } from "./features/export/pptx.js";
export { EXPORT_FORMATS, exportFormatsFor, exportFormatById } from "./features/export/registry.js";
export {
  DOCUMENT_PRINT_GEOMETRY,
  PRESENTATION_PRINT_GEOMETRY,
  PRINT_DOCUMENT_MARKER,
  PRINT_MARKER,
  PRINT_PRESENTATION_MARKER,
  pausePrintVideos,
  printMarkerClasses,
  printWorkKindForSourceFile,
} from "./features/export/print.js";
export type { PrintWorkKind } from "./features/export/print.js";
export {
  presentationBlockAttributes,
  presentationBlockControls,
  presentationEmptySlide,
  presentationRoot,
  presentationSlideBlock,
  presentationSlideFrame,
  presentationSlideToolbar,
} from "./features/presentation/chrome.js";
export { SettingsApp } from "./features/settings/SettingsApp.js";
export { VimSettings, mountVimSettings } from "./features/settings/VimSettings.js";
export type { VimEditorBridge, VimSettingsProps } from "./features/settings/VimSettings.js";
export type {
  AuthoringSeam,
  CardAction,
  ElefMountOptions,
  ElefShell,
  LibraryFilter,
  LibraryOperation,
  NoticeTone,
  UpdaterSeam,
  UpdaterStatus,
} from "./application/types.js";
export type { ElefHost } from "@elef/contracts";
