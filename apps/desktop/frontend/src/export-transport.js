// Desktop PPTX export adapter: builds the shared PPTX model from local Work
// source, renders it with the shared client engine, and saves the bytes
// through the native save dialog. Mirrors the web pptx_export_host_controller
// edges (model + engine + delivery): the model comes from the shared
// pptx-model builder instead of a Rails JSON endpoint, and delivery goes
// through the save_pptx_bytes command instead of an HTTP download. The
// generator library ships with the app (assets/pptxgen.bundle.js), so export
// works fully offline. Model and engine come through the deferred entries,
// never the bare client barrel (the Stable profile forbids that specifier).
// Raw command names stay inside this adapter.
import { dataUriToBlob, exportPptxModel } from "@elef/client/pptx-engine"
import { buildPptxModel } from "@elef/client/pptx-model"

const PPTX_LIBRARY_URL = "./assets/pptxgen.bundle.js"
const ASSET_DIGEST = /^[a-f0-9]{64}$/i
// Ported from MAX_REMOTE_IMAGES_BYTES in
// Presentations::PptxExport: the per-image 10 MB cap lives in the Rust
// fetch command, while the per-export total lives here, where every remote
// image of the export is visible.
const MAX_REMOTE_IMAGES_BYTES = 30 * 1024 * 1024

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
      const blob = await engine(model, { libraryUrl, prepareMedia: createDesktopPrepareMedia({ invoke, workId }) })
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
      return invoke("save_pptx_bytes", { filename: model.filename, bytes })
    }
  }
}

// Desktop prepareMedia seam for the shared engine: same media-map shape as
// the shared prepareMedia, but every byte resolves through IPC, never
// webview fetch. The desktop CSP restricts connect-src to IPC, so the
// shared fetch of elefasset:// and https:// render-stage URLs would be
// blocked and fail the whole export. data: URLs pass through, local
// elefasset:// media resolves through the verified asset read, and remote
// images resolve through the strict server-ported policy command, whose
// per-image caps the command enforces. The 30 MB per-export remote total
// accumulates here with the server's message.
export function createDesktopPrepareMedia({ invoke, workId, remoteImagesCap = MAX_REMOTE_IMAGES_BYTES } = {}) {
  if (typeof invoke !== "function") throw new TypeError("createDesktopPrepareMedia requires an invoke transport.")
  return async function desktopPrepareMedia(stage) {
    const media = new Map()
    const objectUrls = []
    const fetchedMedia = new Map()
    let remoteImageBytes = 0
    const elements = [...stage.querySelectorAll("img[src], video[src]")]
    try {
      await Promise.all(elements.map(async (element) => {
        const source = element.getAttribute("src")
        let pending = fetchedMedia.get(source)
        if (!pending) {
          pending = resolveDesktopMediaSource(source, { invoke, workId })
          fetchedMedia.set(source, pending)
        }
        const data = await pending
        const blob = dataUriToBlob(data)
        if (canonicalRemoteImageUrl(source)) {
          remoteImageBytes += blob.size
          if (remoteImageBytes > remoteImagesCap) throw new Error("Linked images exceed the 30 MB PPTX export limit.")
        }
        const objectUrl = URL.createObjectURL(blob)
        objectUrls.push(objectUrl)
        element.src = objectUrl
        media.set(element, { data, contentType: blob.type || (element.tagName === "VIDEO" ? "video/mp4" : "image/png") })
        if (element.tagName === "IMG") await element.decode()
      }))
      if (stage.querySelectorAll(".katex").length) await stage.ownerDocument?.fonts?.ready
      return { media, objectUrls }
    } catch (error) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      throw error
    }
  }
}

function resolveDesktopMediaSource(source, { invoke, workId }) {
  if (source.startsWith("data:")) return Promise.resolve(source)
  const digest = elefAssetDigest(source)
  if (digest) return invoke("read_pptx_asset", { id: workId, digest })
  const remoteUrl = canonicalRemoteImageUrl(source)
  if (remoteUrl) return invoke("fetch_remote_image", { url: remoteUrl })
  return Promise.reject(new Error("A presentation image or video could not be loaded."))
}

function elefAssetDigest(source) {
  let url
  try {
    url = new URL(source)
  } catch (_error) {
    return null
  }
  const elefAssetOrigin = url.protocol === "elefasset:"
    || (url.protocol === "http:" && url.hostname === "elefasset.localhost")
  if (!elefAssetOrigin) return null
  const segments = url.pathname.split("/")
  const digest = segments.length === 3 ? segments[2] : ""
  if (!digest || !ASSET_DIGEST.test(digest)) return null
  return digest.toLowerCase()
}

function canonicalRemoteImageUrl(source) {
  if (source.startsWith("//")) return `https:${source}`
  if (/^https?:\/\//i.test(source)) return source
  return null
}
