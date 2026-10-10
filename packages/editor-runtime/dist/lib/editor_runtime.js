import { application } from "../controllers/application.js";
import appearanceController from "../controllers/appearance_controller.js";
import documentLinkPaletteController from "../controllers/document_link_palette_controller.js";
import documentPagesController from "../controllers/document_pages_controller.js";
import editorController from "../controllers/editor_controller.js";
import mathShortcutPaletteController from "../controllers/math_shortcut_palette_controller.js";
import mathShorthandController from "../controllers/math_shorthand_controller.js";
import mediaController from "../controllers/media_controller.js";
import mermaidAssistController from "../controllers/mermaid_assist_controller.js";
import mermaidDiagramsController from "../controllers/mermaid_diagrams_controller.js";
import previewController from "../controllers/preview_controller.js";
import slideOverviewController from "../controllers/slide_overview_controller.js";
import snippetPaletteController from "../controllers/snippet_palette_controller.js";
import visualEditorController from "../controllers/visual_editor_controller.js";
if (typeof __ELEF_E2E__ !== "undefined" && __ELEF_E2E__) {
  const handleError = application.handleError.bind(application);
  application.handleError = (error, message, detail) => {
    globalThis.__elefE2EControllerErrors ||= [];
    globalThis.__elefE2EControllerErrors.push({
      message: String(message),
      identifier: detail?.identifier || "",
      elementId: detail?.element?.id || "",
      errorName: error?.name || "",
      errorMessage: error?.message || String(error),
      causeName: error?.cause?.name || "",
      causeMessage: error?.cause?.message || "",
      errorStack: error?.stack || "",
      causeStack: error?.cause?.stack || ""
    });
    handleError(error, message, detail);
  };
}
let editorRuntimeRegistered = false;
function registerEditorRuntime() {
  if (editorRuntimeRegistered) return;
  editorRuntimeRegistered = true;
  register("editor", editorController);
  register("appearance", appearanceController);
  register("document-link-palette", documentLinkPaletteController);
  register("math-shortcut-palette", mathShortcutPaletteController);
  register("math-shorthand", mathShorthandController);
  register("mermaid-assist", mermaidAssistController);
  register("media", mediaController);
  register("preview", previewController);
  register("visual-editor", visualEditorController);
  register("slide-overview", slideOverviewController);
  register("document-pages", documentPagesController);
  register("mermaid-diagrams", mermaidDiagramsController);
  register("snippet-palette", snippetPaletteController);
}
function register(identifier, controller) {
  application.register(identifier, controller);
}
export {
  registerEditorRuntime
};
