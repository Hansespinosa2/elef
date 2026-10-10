// Narrow boot API: the only supported way for hosts to consume the shared
// Stimulus editor shell. Hosts must never deep-import controllers or lib
// modules; bundlers resolve this barrel (desktop) and the Rails importmap
// pins its transpiled dist/ entry plus the served controller modules.
export { registerEditorRuntime } from "./lib/editor_runtime.js";
export { mountEditorHosts } from "./lib/editor_view.js";
export { startFileLibraryApplication } from "./lib/file_library_application.js";
// Neutral client-mount tokens (`data-client-mount`): hosts boot the same
// mounts without naming the Stimulus controllers behind them.
export {
  clientMountController,
  startClientMounts,
  translateClientMounts,
} from "./lib/client_mounts.js";
// Shared Stimulus application instance (Rails lazy-loads its remaining host
// controllers onto it; the desktop registers the shell onto it).
export { application } from "./controllers/application.js";
// Web-worker bootstrap entry (desktop renderer worker).
export { renderWorkerMessage } from "./lib/renderer_worker.js";
// Registry merge injected into both hosts' authoring transports.
export { mergeAuthoringRegistryEntries } from "./lib/authoring_registry_merge.js";
// Registry application injected into the desktop authoring transport.
export { applyAuthoringRegistryToEditor } from "./controllers/authoring_registry.js";
// Thin host-adapter seams kept in the web host.
export { editorFor } from "./lib/editor_controller_lookup.js";
export { applyEditorSource } from "./lib/editor_source.js";
export { waitForEditorController } from "./lib/editor_ready.js";
export { presentConflictDialog } from "./lib/conflict_dialog.js";
export { mountHostPresentationEditor } from "./lib/presentation_editor_host.js";
