import "./renderer.bundle.js"
import { renderWorkerMessage } from "@elef/editor-runtime/worker"

const { renderPreview, renderMarkdownBlock } = self.ElefRenderer

self.addEventListener("message", (event) => {
  self.postMessage(renderWorkerMessage(event.data, renderPreview, renderMarkdownBlock))
})
