import { dataUriToBlob, exportPptxModel } from "./pptx.js"

// Deferred engine entry for hosts that must not couple to the client boot
// barrel (the desktop Stable profile forbids the bare specifier; the web
// host keeps importing the barrel). Re-exports only the orchestration the
// desktop save flow needs; the model builder stays in ./pptx_model.
export { dataUriToBlob, exportPptxModel }
