// Desktop PPTX export adapter: builds the shared PPTX model from local Work
// source, renders it with the shared client engine, and saves the bytes
// through the native save dialog. Mirrors the web pptx_export_host_controller
// edges (model + engine + delivery): the model comes from the shared
// pptx-model builder instead of a Rails JSON endpoint, and delivery goes
// through the save_pptx_bytes command instead of an HTTP download. The
// generator library ships with the app (assets/pptxgen.bundle.js), so export
// works fully offline. Raw command names stay inside this adapter.
import { exportPptxModel } from "@elef/client"
import { buildPptxModel } from "@elef/client/pptx-model"

const PPTX_LIBRARY_URL = "./assets/pptxgen.bundle.js"
const ASSET_DIGEST = /^[a-f0-9]{64}$/i

export function createExportTransport({ invoke, libraryUrl = PPTX_LIBRARY_URL, engine = exportPptxModel, modelBuilder = buildPptxModel } = {}) {
  if (typeof invoke !== "function") throw new TypeError("createExportTransport requires an invoke transport.")
  return {
    async exportPresentationPptx(workId, { title, source } = {}) {
      if (!workId) throw new Error("Open a Work before exporting it.")
      if (typeof source !== "string") throw new Error("The Work source is unavailable for export.")
      const media = await invoke("list_media", { id: workId })
      const mediaMap = {}
      for (const item of media ?? []) {
        const digest = String(item?.digest ?? "")
        if (!ASSET_DIGEST.test(digest)) continue
        mediaMap[`elef-asset:${digest}`] = {
          src: `elefasset://localhost/${encodeURIComponent(String(workId))}/${encodeURIComponent(digest)}`,
          contentType: item?.content_type ?? ""
        }
      }
      const model = await modelBuilder({ source, title, mediaMap })
      const blob = await engine(model, { libraryUrl })
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
      return invoke("save_pptx_bytes", { filename: model.filename, bytes })
    }
  }
}
