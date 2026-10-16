// TEST-ONLY re-export of pptx stage internals (F8). Unstable by contract:
// hosts and features must use the public barrel (exportPptxModel,
// downloadBlob). Only test files may import @elef/client/pptx-test-internals.
export {
  createPresentation,
  createRenderStage,
  loadPptxLibrary,
  prepareMedia,
  renderSlides,
} from "./features/export/pptx.js";
