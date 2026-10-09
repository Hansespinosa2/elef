export { ADAPTER_METHODS, assertEditorAdapter } from "./session/editor_adapter.js";
export { createSaveFlow } from "./session/save_flow.js";
export { createTitleSaveFlow } from "./session/title_save_flow.js";
export { createWorkSession } from "./session/work_session.js";
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
export { createPresentationNavigation, presentationActionForKey } from "./features/presentation/navigation.js";
export { attachCanvasScaling, PresentationController, mountPresentation } from "./features/presentation/presentation.js";
export { PresentationEditor, mountPresentationEditor } from "./features/presentation/editor.js";
export { DocumentEditor } from "./features/document/document_editor.js";
export { SlideOverview } from "./features/overview/overview.js";
export { exportPptxModel, loadPptxLibrary, createPresentation, primaryFont, createRenderStage, slideMarkup, blockMarkup, escapeHtml, prepareMedia, dataUriToBlob, renderSlides, cssLineSpacingMultiple, relativeRect, pixelRectToInches, cssFontSize, cssCharSpacing, colorHex, safeHyperlink, gradientBackground, downloadBlob } from "./features/export/pptx.js";
export { EXPORT_FORMATS, exportFormatsFor, exportFormatById } from "./features/export/registry.js";
export {
  presentationBlockAttributes,
  presentationBlockControls,
  presentationEmptySlide,
  presentationRoot,
  presentationSlideBlock,
  presentationSlideFrame,
  presentationSlideToolbar,
} from "./features/presentation/chrome.js";
export { GraphController } from "./features/graph/graphController.js";
export type { GraphControllerOptions } from "./features/graph/graphController.js";
export { renderGraphView, graphNodeHref } from "./features/graph/graphView.js";
export type { GraphData, GraphEdgeData, GraphNodeData } from "./features/graph/graphView.js";
export { clampZoom, edgeGeometry, initNodeStates, searchMatches, stepSimulation, wrapLabel } from "./features/graph/graphLayout.js";
export type { GraphLayoutData, GraphNodeState } from "./features/graph/graphLayout.js";
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
