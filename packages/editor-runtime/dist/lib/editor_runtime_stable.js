import { application } from "../controllers/application.js";
import { installEditorRuntimeErrorHook } from "./editor_runtime_errors.js";
import appearanceController from "../controllers/appearance_controller.js";
import artLayoutController from "../controllers/art_layout_controller.js";
import commandPaletteController from "../controllers/command_palette_controller.js";
import documentPagesController from "../controllers/document_pages_controller.js";
import editorController from "../controllers/editor_controller.js";
import mathShortcutPaletteController from "../controllers/math_shortcut_palette_controller.js";
import mathShorthandController from "../controllers/math_shorthand_controller.js";
import mediaController from "../controllers/media_controller.js";
import mermaidAssistController from "../controllers/mermaid_assist_controller.js";
import mermaidDiagramsController from "../controllers/mermaid_diagrams_controller.js";
import previewController from "../controllers/preview_controller.js";
import snippetPaletteController from "../controllers/snippet_palette_controller.js";
installEditorRuntimeErrorHook(application);
let editorRuntimeRegistered = false;
function registerEditorRuntime() {
  if (editorRuntimeRegistered) return;
  editorRuntimeRegistered = true;
  register("editor", editorController);
  register("appearance", appearanceController);
  register("command-palette", commandPaletteController);
  register("math-shortcut-palette", mathShortcutPaletteController);
  register("math-shorthand", mathShorthandController);
  register("mermaid-assist", mermaidAssistController);
  register("media", mediaController);
  register("preview", previewController);
  register("document-pages", documentPagesController);
  register("mermaid-diagrams", mermaidDiagramsController);
  register("snippet-palette", snippetPaletteController);
  register("art-layout", artLayoutController);
}
function register(identifier, controller) {
  application.register(identifier, controller);
}
export {
  registerEditorRuntime
};
