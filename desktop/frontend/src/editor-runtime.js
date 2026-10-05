import { application } from "controllers/application"

if (__ELEF_E2E__) {
  const handleError = application.handleError.bind(application)
  application.handleError = (error, message, detail) => {
    globalThis.__elefE2EControllerErrors ||= []
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
    })
    handleError(error, message, detail)
  }
}

let editorRuntime
let libraryRuntime

export function loadDesktopEditorRuntime() {
  if (!editorRuntime) {
    editorRuntime = loadKatex()
      .then(() => Promise.all([
        import("controllers/editor_controller"),
        import("controllers/appearance_controller"),
        import("controllers/document_link_palette_controller"),
        import("controllers/math_shortcut_palette_controller"),
        import("controllers/math_shorthand_controller"),
        import("controllers/mermaid_assist_controller"),
        import("controllers/media_controller"),
        import("controllers/preview_controller"),
        import("controllers/presentation_canvas_controller"),
        import("controllers/presentation_controller"),
        import("controllers/visual_editor_controller"),
        import("controllers/presentation_editor_controller"),
        import("controllers/slide_overview_controller"),
        import("controllers/document_pages_controller"),
        import("controllers/mermaid_diagrams_controller"),
        import("controllers/snippet_palette_controller")
      ]))
      .then(([editor, appearance, documentLinks, mathPalette, mathShorthand, mermaidAssist, media, preview,
        presentationCanvas, presentation, visualEditor, presentationEditor, slideOverview, documentPages,
        mermaidDiagrams, snippetPalette]) => {
        register("editor", editor.default)
        register("appearance", appearance.default)
        register("document-link-palette", documentLinks.default)
        register("math-shortcut-palette", mathPalette.default)
        register("math-shorthand", mathShorthand.default)
        register("mermaid-assist", mermaidAssist.default)
        register("media", media.default)
        register("preview", preview.default)
        register("presentation-canvas", presentationCanvas.default)
        register("presentation", presentation.default)
        register("visual-editor", visualEditor.default)
        register("presentation-editor", presentationEditor.default)
        register("slide-overview", slideOverview.default)
        register("document-pages", documentPages.default)
        register("mermaid-diagrams", mermaidDiagrams.default)
        register("snippet-palette", snippetPalette.default)
      })
      .catch(error => {
        editorRuntime = null
        throw error
      })
  }
  return editorRuntime
}

export function loadDesktopLibraryRuntime() {
  if (!libraryRuntime) {
    libraryRuntime = import("controllers/document_graph_controller")
      .then(({ default: controller }) => register("document-graph", controller))
      .catch(error => {
        libraryRuntime = null
        throw error
      })
  }
  return libraryRuntime
}

async function loadKatex() {
  const { default: katex } = await import("katex")
  globalThis.katex = katex
}

function register(identifier, controller) {
  application.register(identifier, controller)
}
