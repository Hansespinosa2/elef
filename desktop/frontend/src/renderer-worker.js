import "./renderer.bundle.js"
import { renderWorkerMessage } from "lib/renderer_worker"

const { renderPreview } = self.ElefRenderer

self.addEventListener("message", (event) => {
  self.postMessage(renderWorkerMessage(event.data, renderPreview))
})
