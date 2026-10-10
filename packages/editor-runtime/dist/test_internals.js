import { mergeAuthoringRegistryEntries } from "./lib/authoring_registry_merge.js";
import {
  clientMountController,
  startClientMounts,
  translateClientMounts
} from "./lib/client_mounts.js";
import { presentConflictDialog } from "./lib/conflict_dialog.js";
import { editorFor } from "./lib/editor_controller_lookup.js";
import { waitForEditorController } from "./lib/editor_ready.js";
import { applyEditorSource } from "./lib/editor_source.js";
import { mountEditorHosts } from "./lib/editor_view.js";
import { renderWorkerMessage } from "./lib/renderer_worker.js";
import { mermaidAssetUrl } from "./controllers/mermaid_runtime.js";
import { translateElementMounts } from "./lib/client_mounts.js";
import { createDeckOpenFlow, prepareDeckOpen } from "./lib/deck_open_flow.js";
import { createDocumentGraphCache } from "./lib/document_graph_cache.js";
import { bindEditorAction, editorActionControl } from "./lib/editor_actions.js";
import { createCodeMirrorBinding } from "./lib/editor_binding.js";
import { createDocumentState } from "./lib/editor_document_state.js";
import {
  configureEditorKind,
  enableVisualModeAfterPreview,
  enableVisualModeFromInstalledPreview,
  installPreviewHtml,
  renderEditorView
} from "./lib/editor_view.js";
import {
  DESKTOP_FEATURE_FLAGS,
  applyDesktopFeatureFlags,
  desktopFeatureEnabled
} from "./lib/feature_flags.js";
import { measurePaintedAction, percentile95 } from "./lib/performance_measurement.js";
import { buildPreviewRequestBody } from "./lib/preview_request_body.js";
import { setProjectionBlockEditable } from "./lib/projection_editability.js";
import { createRendererClient } from "./lib/renderer_worker_client.js";
import { createRequestGuard } from "./lib/request_identity.js";
import { formatLineNumber } from "./lib/vim_line_numbers.js";
export {
  DESKTOP_FEATURE_FLAGS,
  applyDesktopFeatureFlags,
  applyEditorSource,
  bindEditorAction,
  buildPreviewRequestBody,
  clientMountController,
  configureEditorKind,
  createCodeMirrorBinding,
  createDeckOpenFlow,
  createDocumentGraphCache,
  createDocumentState,
  createRendererClient,
  createRequestGuard,
  desktopFeatureEnabled,
  editorActionControl,
  editorFor,
  enableVisualModeAfterPreview,
  enableVisualModeFromInstalledPreview,
  formatLineNumber,
  installPreviewHtml,
  measurePaintedAction,
  mergeAuthoringRegistryEntries,
  mermaidAssetUrl,
  mountEditorHosts,
  percentile95,
  prepareDeckOpen,
  presentConflictDialog,
  renderEditorView,
  renderWorkerMessage,
  setProjectionBlockEditable,
  startClientMounts,
  translateClientMounts,
  translateElementMounts,
  waitForEditorController
};
