import { application } from "controllers/application"
import katex from "katex"
import EditorController from "controllers/editor_controller"
import DocumentLinkPaletteController from "controllers/document_link_palette_controller"
import MathShortcutPaletteController from "controllers/math_shortcut_palette_controller"
import MathShorthandController from "controllers/math_shorthand_controller"
import MermaidAssistController from "controllers/mermaid_assist_controller"
import SnippetPaletteController from "controllers/snippet_palette_controller"

globalThis.katex = katex

application.register("editor", EditorController)
application.register("document-link-palette", DocumentLinkPaletteController)
application.register("math-shortcut-palette", MathShortcutPaletteController)
application.register("math-shorthand", MathShorthandController)
application.register("mermaid-assist", MermaidAssistController)
application.register("snippet-palette", SnippetPaletteController)
