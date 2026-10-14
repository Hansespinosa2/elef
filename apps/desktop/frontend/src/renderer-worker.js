import "./renderer.bundle.js"
import { renderWorkerMessage } from "@elef/editor-runtime/worker"
import { editorChrome } from "@elef/editor-runtime/editor-chrome"
import { desktopProfile } from "./desktop-profile.js"

const { renderPreview: devRenderPreview, renderPreviewCore, renderMarkdownBlock } = self.ElefRenderer

// Stable previews keep rich rendering but drop the visual-editor position
// controls; Dev keeps the full editor chrome.
const stableChrome = { ...editorChrome, positionControl: () => "" }
const renderPreview = desktopProfile === "stable"
  ? (input) => renderPreviewCore(input, { chrome: stableChrome })
  : devRenderPreview

self.addEventListener("message", (event) => {
  self.postMessage(renderWorkerMessage(event.data, renderPreview, renderMarkdownBlock))
})
