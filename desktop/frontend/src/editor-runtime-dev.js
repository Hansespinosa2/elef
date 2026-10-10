import { application } from "controllers/application"
import { loadEditorRuntime as loadSharedEditorRuntime, loadLibraryRuntime as loadSharedLibraryRuntime } from "lib/editor_runtime"

let lineageRuntime

export function loadEditorRuntime() {
  return loadSharedEditorRuntime()
}

export function loadLibraryRuntime() {
  if (!lineageRuntime) {
    lineageRuntime = Promise.all([
      loadSharedLibraryRuntime(),
      import("controllers/lineage_graph_controller")
    ]).then(([, { default: controller }]) => application.register("lineage-graph", controller))
      .catch(error => {
        lineageRuntime = null
        throw error
      })
  }
  return lineageRuntime
}
