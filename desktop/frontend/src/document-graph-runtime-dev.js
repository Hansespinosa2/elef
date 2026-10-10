import { buildDocumentGraph } from "lib/document_links"
import { createDocumentGraphCache } from "lib/document_graph_cache"

export const documentGraphRuntime = Object.freeze({
  build: buildDocumentGraph,
  createCache: createDocumentGraphCache
})
