import { renderMarkdownBlock as renderMarkdownBlockCore } from "./renderer.js"
import type { MarkdownBlockOptions } from "./renderer.js"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"

// The composed block render the shipped bundle exposes
// (renderer_global.ts): bare projection plus editor chrome, so TypeScript
// consumers that need byte-identical output with the server (MiniRacer),
// workers, and importmap get it through this entry. Export flows render
// here; interactive previews use the same composition through the bundle.
export function renderMarkdownBlock(source = "", options: MarkdownBlockOptions = {}): string {
  return renderMarkdownBlockCore(source, { ...options, chrome: editorChrome })
}
