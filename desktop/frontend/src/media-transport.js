const MAX_MEDIA_BYTES = 50 * 1024 * 1024

export function createMediaFetch({ invoke, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  return async (input, init = {}) => {
    let url
    try {
      url = new URL(typeof input === "string" ? input : input.url)
    } catch (_error) {
      return fetchImpl(input, init)
    }
    if (url.protocol !== "elef-upload:") return fetchImpl(input, init)

    if ((init.method || "GET").toUpperCase() !== "POST") {
      return jsonResponse({ error: "Media uploads require POST." }, 405)
    }
    const file = init.body instanceof FormData ? init.body.get("file") : null
    if (!(file instanceof Blob)) return jsonResponse({ error: "Choose a media file to upload." }, 400)
    if (file.size === 0 || file.size > MAX_MEDIA_BYTES) {
      return jsonResponse({ error: "Media files must be between 1 byte and 50 MB." }, 413)
    }
    const deckPath = url.pathname.slice(1).split("/")
    let deckId
    try {
      deckId = decodeURIComponent(deckPath[0])
    } catch (_error) {
      return jsonResponse({ error: "The media upload destination is invalid." }, 400)
    }
    if (url.hostname !== "localhost" || deckPath.length !== 1 || !deckId || deckId.includes("/")) {
      return jsonResponse({ error: "The media upload destination is invalid." }, 400)
    }

    try {
      const rawBytes = new Uint8Array(await file.arrayBuffer())
      const result = await invoke("upload_asset", rawBytes, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-elef-deck-id": deckId,
          "x-elef-filename": file.name || "image",
          "x-elef-fit": init.body.get("fit") || "contain"
        }
      })
      return jsonResponse(result, 201)
    } catch (error) {
      const status = error?.code === "too_large" ? 413 : 422
      return jsonResponse({ error: error?.message || "Media could not be uploaded." }, status)
    }
  }
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  })
}
