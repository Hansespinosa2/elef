const FIELDS = {
  snippets: ["name", "trigger", "description", "category", "body"],
  math_shortcuts: ["name", "aliases", "description", "prefix", "expansion"]
}

function entryBody(registry, entry) {
  return Object.fromEntries(FIELDS[registry].map(field => [field, entry[field]]))
}

function sameEntry(registry, left, right) {
  return JSON.stringify(entryBody(registry, left)) === JSON.stringify(entryBody(registry, right))
}

function responseCode(status) {
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 403) return "unsupported"
  if (status === 422) return "invalid_input"
  if (status === 413) return "too_large"
  return status >= 500 ? "internal" : "invalid_input"
}

export function createRailsAuthoringSettingsTransport({
  snippetsUrl,
  mathShortcutsUrl,
  fetchImpl = globalThis.fetch.bind(globalThis),
  csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content || ""
}) {
  const urls = { snippets: snippetsUrl, math_shortcuts: mathShortcutsUrl }
  let registries = { snippets: [], math_shortcuts: [] }

  async function request(url, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
      headers["X-CSRF-Token"] = csrfToken()
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!response.ok) {
      throw Object.assign(new Error("The authoring settings request failed."), {
        code: responseCode(response.status),
        retryable: response.status >= 500 || response.status === 429
      })
    }
    return response.status === 204 ? null : response.json()
  }

  async function readRegistry(registry) {
    const result = await request(urls[registry])
    if (!Array.isArray(result?.entries)) throw Object.assign(new Error("The authoring settings response was invalid."), { code: "internal" })
    registries[registry] = result.entries
    return result.entries
  }

  async function readRegistries() {
    const [snippets, mathShortcuts] = await Promise.all([
      readRegistry("snippets"),
      readRegistry("math_shortcuts")
    ])
    return { snippets, math_shortcuts: mathShortcuts, hashes: { snippets: null, math_shortcuts: null } }
  }

  async function writeRegistry({ registry, entries }) {
    const current = registries[registry].filter(entry => !entry.built_in)
    const next = entries.filter(entry => !entry.built_in)
    const currentById = new Map(current.map(entry => [String(entry.id), entry]))
    const nextById = new Map(next.map(entry => [String(entry.id), entry]))
    const removed = current.filter(entry => !nextById.has(String(entry.id)))
    const created = next.filter(entry => !currentById.has(String(entry.id)))
    const updated = next.filter(entry => {
      const previous = currentById.get(String(entry.id))
      return previous && !sameEntry(registry, previous, entry)
    })
    const changes = [
      ...removed.map(entry => ({ kind: "delete", entry })),
      ...created.map(entry => ({ kind: "create", entry })),
      ...updated.map(entry => ({ kind: "update", entry }))
    ]
    if (changes.length === 0) return { entries: current }
    if (changes.length !== 1) {
      throw Object.assign(new Error("Authoring settings must be saved one entry at a time."), { code: "invalid_input" })
    }

    const { kind, entry } = changes[0]
    const collectionUrl = urls[registry]
    const resourceUrl = `${collectionUrl.replace(/\.json(?:\?.*)?$/, "")}/${encodeURIComponent(entry.id)}.json`
    let savedEntry = null
    if (kind === "delete") {
      await request(resourceUrl, { method: "DELETE" })
    } else {
      const singular = registry === "snippets" ? "snippet" : "math_shortcut"
      const url = kind === "create" ? collectionUrl : resourceUrl
      const result = await request(url, {
        method: kind === "create" ? "POST" : "PATCH",
        body: { [singular]: entryBody(registry, entry) }
      })
      savedEntry = result?.entry || result
      if (!savedEntry || savedEntry.id === undefined) {
        throw Object.assign(new Error("The saved authoring entry response was invalid."), { code: "internal" })
      }
    }

    const nextRegistry = registries[registry].filter(existing => {
      if (existing.built_in) return true
      if (String(existing.id) === String(entry.id)) return kind === "update"
      return true
    })
    if (kind === "create") nextRegistry.push(savedEntry)
    if (kind === "update") {
      const index = nextRegistry.findIndex(existing => String(existing.id) === String(entry.id))
      if (index >= 0) nextRegistry[index] = savedEntry
    }
    registries[registry] = nextRegistry
    return { entries: nextRegistry.filter(existing => !existing.built_in) }
  }

  return { readRegistries, writeRegistry }
}
