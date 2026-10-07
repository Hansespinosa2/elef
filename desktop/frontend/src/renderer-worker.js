import "./renderer.bundle.js"
import { renderWorkerMessage } from "lib/renderer_worker"

const { renderPreview, renderMarkdownBlock } = self.ElefRenderer

self.addEventListener("message", (event) => {
  self.postMessage(renderWorkerMessage(event.data, renderPreview, renderMarkdownBlock))
})
