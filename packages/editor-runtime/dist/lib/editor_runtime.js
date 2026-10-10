import { application } from "../controllers/application.js";
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
let editorRuntime;
function registerEditorRuntime() {
  if (!editorRuntime) {
    editorRuntime = Promise.all([
      import("../controllers/editor_controller.js"),
      import("../controllers/appearance_controller.js"),
      import("../controllers/document_link_palette_controller.js"),
      import("../controllers/math_shortcut_palette_controller.js"),
      import("../controllers/math_shorthand_controller.js"),
      import("../controllers/mermaid_assist_controller.js"),
      import("../controllers/media_controller.js"),
      import("../controllers/preview_controller.js"),
      import("../controllers/visual_editor_controller.js"),
      import("../controllers/slide_overview_controller.js"),
      import("../controllers/document_pages_controller.js"),
      import("../controllers/mermaid_diagrams_controller.js"),
      import("../controllers/snippet_palette_controller.js")
    ]).then(([
      editor,
      appearance,
      documentLinks,
      mathPalette,
      mathShorthand,
      mermaidAssist,
      media,
      preview,
      visualEditor,
      slideOverview,
      documentPages,
      mermaidDiagrams,
      snippetPalette
    ]) => {
      register("editor", editor.default);
      register("appearance", appearance.default);
      register("document-link-palette", documentLinks.default);
      register("math-shortcut-palette", mathPalette.default);
      register("math-shorthand", mathShorthand.default);
      register("mermaid-assist", mermaidAssist.default);
      register("media", media.default);
      register("preview", preview.default);
      register("visual-editor", visualEditor.default);
      register("slide-overview", slideOverview.default);
      register("document-pages", documentPages.default);
      register("mermaid-diagrams", mermaidDiagrams.default);
      register("snippet-palette", snippetPalette.default);
    }).catch((error) => {
      editorRuntime = null;
      throw error;
    });
  }
  return editorRuntime;
}
function register(identifier, controller) {
  application.register(identifier, controller);
}
export {
  registerEditorRuntime
};
