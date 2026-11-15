import { EditorEngine } from "./engine.js"
export type { EditorEngine as EditorHandle } from "./engine.js"

export function mountEditor({ element }: { element: HTMLElement }): EditorEngine {
  const editor = new EditorEngine(element)
  editor.connect()
  return editor
}

export { createDocumentState } from "./document_state.js"
export { editorTabBinding, editorTabKeymap } from "./tab_keymap.js"
export { formatLineNumber } from "./line_numbers.js"
export { snippetStopsField, snippetStopsEffect } from "./snippet_stops.js"
export type { SnippetStop, SnippetStopsValue } from "./snippet_stops.js"
export { livePreviewField, livePreviewMode, pythonFenceRunEffect, findExecutablePythonFenceAt, runActivePythonFence } from "./live_preview.js"
export type { ExecutablePythonFenceRange } from "./live_preview.js"
export { MERMAID_CONTAINER_SELECTOR, MERMAID_ERROR_CLASS, mermaidContainers, nextMermaidRenderId, mermaidAssetUrl, loadMermaid, mermaidConfig, renderMermaidDiagrams, renderMermaidSvg } from "./mermaid_runtime.js"
export {
  PYTHON_CONTAINER_SELECTOR,
  PYTHON_ERROR_CLASS,
  PYTHON_EXECUTION_TIMEOUT_MS,
  pythonContainers,
  pythonWorkerUrl,
  pythonRuntimeBaseUrl,
  pythonThemeConfig,
  runPythonCode,
  renderPythonBlock,
  renderPythonBlocks,
  mountPythonExecutionResult,
  sanitizePythonSvg,
  sanitizePythonTable,
  clearPythonExecutionCache,
  setPythonExecutorForTests,
  setPythonExecutionTimeoutForTests,
  terminatePythonWorker,
  getPythonWorkerMessageCount,
  resetPythonWorkerMessageCount
} from "./python_runtime.js"
export type {
  PythonThemeConfig,
  PythonSliderSpec,
  PythonRenderFrame,
  PythonExecutionResult,
  PythonExecutor
} from "./python_runtime.js"
