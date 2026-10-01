import { loadDesktopAuthoringRegistry } from "./authoring-registry-loader.js"
import { application } from "controllers/application"
import katex from "katex"
import EditorController from "controllers/editor_controller"
import DocumentLinkPaletteController from "controllers/document_link_palette_controller"
import DocumentGraphController from "controllers/document_graph_controller"
import MathShortcutPaletteController from "controllers/math_shortcut_palette_controller"
import MathShorthandController from "controllers/math_shorthand_controller"
import MermaidAssistController from "controllers/mermaid_assist_controller"
import MediaController from "controllers/media_controller"
import PreviewController from "controllers/preview_controller"
import PresentationCanvasController from "controllers/presentation_canvas_controller"
import VisualEditorController from "controllers/visual_editor_controller"
import PresentationEditorController from "controllers/presentation_editor_controller"
import SlideOverviewController from "controllers/slide_overview_controller"
import DocumentPagesController from "controllers/document_pages_controller"
import MermaidDiagramsController from "controllers/mermaid_diagrams_controller"
import SnippetPaletteController from "controllers/snippet_palette_controller"

globalThis.katex = katex

application.register("editor", EditorController)
application.register("document-link-palette", DocumentLinkPaletteController)
application.register("document-graph", DocumentGraphController)
application.register("math-shortcut-palette", MathShortcutPaletteController)
application.register("math-shorthand", MathShorthandController)
application.register("mermaid-assist", MermaidAssistController)
application.register("media", MediaController)
application.register("preview", PreviewController)
application.register("presentation-canvas", PresentationCanvasController)
application.register("visual-editor", VisualEditorController)
application.register("presentation-editor", PresentationEditorController)
application.register("slide-overview", SlideOverviewController)
application.register("document-pages", DocumentPagesController)
application.register("mermaid-diagrams", MermaidDiagramsController)
application.register("snippet-palette", SnippetPaletteController)
