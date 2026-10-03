export function createPreviewFetch({ renderer, getContext = () => ({}), fetchImpl = globalThis.fetch.bind(globalThis) }) {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || ""
    if (!url.startsWith("elef-preview://localhost/")) return fetchImpl(input, init)

    try {
      const body = init.body
      if (!(body instanceof FormData)) throw Object.assign(new Error("Preview request was invalid."), { code: "invalid_input" })
      const fieldName = [...body.keys()].find((key) => key.endsWith("[source]"))
      const source = fieldName ? String(body.get(fieldName) || "") : ""
      const context = await getContext(source)
      const result = await renderer.render({
        source,
        kind: context.kind || "presentation",
        title: context.title || "Untitled",
        deckId: context.deckId || "",
        mediaBaseUrl: context.mediaBaseUrl || "",
        documentNodes: context.documentNodes || []
      })
      return jsonResponse(result)
    } catch (error) {
      return jsonResponse({ html: null, warnings: [error.message || "Preview could not be rendered."], editor_map: null }, 422)
    }
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}
