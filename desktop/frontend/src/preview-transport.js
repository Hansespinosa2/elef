export function createPreviewFetch({ renderer, getContext = () => ({}), fetchImpl = globalThis.fetch.bind(globalThis), onEvent = () => {} }) {
  const trace = (event) => {
    try {
      onEvent({ time: performance.now(), ...event })
    } catch (_error) {
      // Diagnostics must never change preview behavior.
    }
  }

  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || ""
    if (!url.startsWith("elef-preview://localhost/")) {
      trace({ stage: "passthrough", url })
      return fetchImpl(input, init)
    }

    try {
      trace({ stage: "request", url })
      const body = init.body
      if (!(body instanceof FormData)) throw Object.assign(new Error("Preview request was invalid."), { code: "invalid_input" })
      const fieldName = [...body.keys()].find((key) => key.endsWith("[source]"))
      const source = fieldName ? String(body.get(fieldName) || "") : ""
      trace({ stage: "context-start", sourceLength: source.length })
      const context = await getContext(source)
      trace({ stage: "context-ready", documentCount: context.documentNodes?.length || 0 })
      trace({ stage: "render-start" })
      const result = await renderer.render({
        source,
        kind: context.kind || "presentation",
        title: context.title || "Untitled",
        deckId: context.deckId || "",
        mediaBaseUrl: context.mediaBaseUrl || "",
        documentNodes: context.documentNodes || []
      })
      trace({ stage: "render-ready", hasHtml: typeof result?.html === "string" })
      return jsonResponse(result)
    } catch (error) {
      trace({ stage: "error", name: error?.name || "Error", message: error?.message || String(error) })
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
