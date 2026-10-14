// Repository-Dev document-graph runtime: assembles the shared graph pieces
// the Stable entry omits (link resolver and cache factory from the shared
// packages, view and controller from the full client dist). The Stable
// variant exports null, so the Stable bundle never imports these modules.
import { buildDocumentGraph } from "@elef/work-model"
import { createDocumentGraphCache } from "@elef/editor-runtime"
import { GraphController, renderGraphView } from "@elef/client"

export const documentGraphRuntime = Object.freeze({
  build: buildDocumentGraph,
  createCache: createDocumentGraphCache,
  renderGraphView,
  GraphController
})
