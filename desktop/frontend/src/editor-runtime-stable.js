import { application } from "controllers/application"

let editorRuntime

export function loadEditorRuntime() {
  if (!editorRuntime) {
    editorRuntime = Promise.all([
      import("controllers/editor_controller"),
      import("controllers/appearance_controller"),
      import("controllers/math_shortcut_palette_controller"),
      import("controllers/math_shorthand_controller"),
      import("controllers/mermaid_assist_controller"),
      import("controllers/media_controller"),
      import("controllers/preview_controller"),
      import("controllers/presentation_canvas_controller"),
      import("controllers/presentation_controller"),
      import("controllers/document_pages_controller"),
      import("controllers/mermaid_diagrams_controller"),
      import("controllers/snippet_palette_controller"),
      import("controllers/vim_settings_controller")
    ])
      .then(([editor, appearance, mathPalette, mathShorthand, mermaidAssist, media, preview,
        presentationCanvas, presentation, documentPages, mermaidDiagrams, snippetPalette, vimSettings]) => {
        register("editor", editor.default)
        register("appearance", appearance.default)
        register("math-shortcut-palette", mathPalette.default)
        register("math-shorthand", mathShorthand.default)
        register("mermaid-assist", mermaidAssist.default)
        register("media", media.default)
        register("preview", preview.default)
        register("presentation-canvas", presentationCanvas.default)
        register("presentation", presentation.default)
        register("document-pages", documentPages.default)
        register("mermaid-diagrams", mermaidDiagrams.default)
        register("snippet-palette", snippetPalette.default)
        register("vim-settings", vimSettings.default)
      })
      .catch(error => {
        editorRuntime = null
        throw error
      })
  }
  return editorRuntime
}

export function loadLibraryRuntime() {
  return Promise.resolve()
}

function register(identifier, controller) {
  application.register(identifier, controller)
}
