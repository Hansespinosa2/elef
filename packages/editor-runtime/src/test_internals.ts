// Test-only entry: internal helpers exercised directly by the committed
// node:test suites in apps/web/test/javascript/. Production hosts must use
// the barrel (".") or "./editor-chrome" only; deep imports of src/ or dist/
// modules are forbidden (see R12). Every name here is imported by at least
// one committed suite — remove a name in the same commit that deletes its
// last importing suite.
//
// The barrel names below are re-exported (not duplicated): the barrel's boot
// graph — the Stimulus application, DOM mounts, file-library orchestration —
// cannot load under node (no DOM, no Stimulus runtime), so suites that
// exercise these lib helpers import them from here instead. Production must
// keep importing them from the barrel.
export { mergeAuthoringRegistryEntries } from "./lib/authoring_registry_merge.js";
export {
  clientMountController,
  startClientMounts,
  translateClientMounts,
} from "./lib/client_mounts.js";
export { presentConflictDialog } from "./lib/conflict_dialog.js";
export { editorFor } from "./lib/editor_controller_lookup.js";
export { waitForEditorController } from "./lib/editor_ready.js";
export { applyEditorSource } from "./lib/editor_source.js";
export { mountEditorHosts } from "./lib/editor_view.js";
export { renderWorkerMessage } from "./lib/renderer_worker.js";
export { mermaidAssetUrl } from "./controllers/mermaid_runtime.js";
export { translateElementMounts } from "./lib/client_mounts.js";
export { createDeckOpenFlow, prepareDeckOpen } from "./lib/deck_open_flow.js";
export { createDocumentGraphCache } from "./lib/document_graph_cache.js";
export { bindEditorAction, editorActionControl } from "./lib/editor_actions.js";
export { createCodeMirrorBinding } from "./lib/editor_binding.js";
export { createDocumentState } from "./lib/editor_document_state.js";
export {
  configureEditorKind,
  enableVisualModeAfterPreview,
  enableVisualModeFromInstalledPreview,
  installPreviewHtml,
  renderEditorView,
} from "./lib/editor_view.js";
export {
  DESKTOP_FEATURE_FLAGS,
  applyDesktopFeatureFlags,
  desktopFeatureEnabled,
} from "./lib/feature_flags.js";
export { measurePaintedAction, percentile95 } from "./lib/performance_measurement.js";
export { buildPreviewRequestBody } from "./lib/preview_request_body.js";
export { setProjectionBlockEditable } from "./lib/projection_editability.js";
export { createRendererClient } from "./lib/renderer_worker_client.js";
export { createRequestGuard } from "./lib/request_identity.js";
export { formatLineNumber } from "./lib/vim_line_numbers.js";
