import assert from "node:assert/strict"
import test from "node:test"
import { createRailsAuthoringSettingsTransport } from "../../../app/javascript/lib/rails_authoring_settings_transport.js"

function jsonResponse(status, body = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body }
  }
}

test("Rails authoring transport reads both catalogs and maps one-entry CRUD to JSON routes", async () => {
  const requests = []
  const existing = { id: 5, name: "Note", trigger: "note", description: "", category: "Markdown", body: "# note", built_in: false }
  const builtin = { id: "default-bold", name: "Bold", trigger: "bold", description: "", category: "Markdown", body: "**x**", built_in: true }
  const transport = createRailsAuthoringSettingsTransport({
    snippetsUrl: "/snippets.json",
    mathShortcutsUrl: "/math_shortcuts.json",
    csrfToken: () => "csrf-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      if (options.method === "GET" && url === "/snippets.json") return jsonResponse(200, { entries: [builtin, existing] })
      if (options.method === "GET") return jsonResponse(200, { entries: [] })
      if (options.method === "POST") {
        const payload = JSON.parse(options.body).snippet
        return jsonResponse(201, { entry: { ...payload, id: 12, built_in: false } })
      }
      if (options.method === "PATCH") {
        const payload = JSON.parse(options.body).snippet
        const id = Number(new URL(url, "http://localhost").pathname.split("/").at(-1).replace(/\.json$/, ""))
        return jsonResponse(200, { entry: { ...payload, id, built_in: false } })
      }
      if (options.method === "DELETE") return jsonResponse(204)
      throw new Error(`Unexpected request ${options.method} ${url}`)
    }
  })

  const catalogs = await transport.readRegistries()
  assert.deepEqual(catalogs.snippets, [builtin, existing])
  assert.deepEqual(catalogs.math_shortcuts, [])
  assert.equal(requests[0].options.headers.Accept, "application/json")

  const created = await transport.writeRegistry({ registry: "snippets", entries: [existing, {
    id: "personal-draft",
    name: "Agenda",
    trigger: "agenda",
    description: "",
    category: "Markdown",
    body: "- ${1:item}",
    built_in: false
  }] })
  assert.equal(requests[2].url, "/snippets.json")
  assert.equal(requests[2].options.method, "POST")
  assert.equal(requests[2].options.headers["X-CSRF-Token"], "csrf-test-token")
  assert.deepEqual(created.entries.map(entry => entry.id), [5, 12])

  const updated = await transport.writeRegistry({ registry: "snippets", entries: [
    { ...existing, name: "Updated note" },
    ...created.entries.filter(entry => entry.id === 12)
  ] })
  assert.equal(requests[3].url, "/snippets/5.json")
  assert.equal(requests[3].options.method, "PATCH")
  assert.equal(updated.entries[0].name, "Updated note")

  const unchanged = await transport.writeRegistry({ registry: "snippets", entries: updated.entries })
  assert.deepEqual(unchanged.entries, updated.entries)
  assert.equal(requests.length, 4)

  await transport.writeRegistry({ registry: "snippets", entries: [updated.entries[0]] })
  assert.equal(requests[4].url, "/snippets/12.json")
  assert.equal(requests[4].options.method, "DELETE")
})

test("Rails authoring transport maps typed HTTP failures without exposing response bodies", async () => {
  const transport = createRailsAuthoringSettingsTransport({
    snippetsUrl: "/snippets.json",
    mathShortcutsUrl: "/math_shortcuts.json",
    fetchImpl: async () => jsonResponse(409, { detail: "private database error" })
  })

  await assert.rejects(transport.readRegistries(), error => {
    assert.equal(error.code, "conflict")
    assert.equal(error.retryable, false)
    assert.doesNotMatch(error.message, /private database error/)
    return true
  })
})
