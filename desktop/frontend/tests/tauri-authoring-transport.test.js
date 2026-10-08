import assert from "node:assert/strict"
import test from "node:test"

import { createTauriAuthoringTransport } from "../src/tauri-authoring-transport.js"

const HASH = "a".repeat(64)

function recordingTransport(handlers, builtInEntries = []) {
  const calls = []
  const transport = createTauriAuthoringTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      return handlers[command](payload)
    },
    builtInEntries,
    mergeEntries: (builtIns, snippets, mathShortcuts) => [
      ...builtIns.map(entry => ({ ...entry, built_in: true })),
      ...snippets,
      ...mathShortcuts
    ]
  })
  return { calls, transport }
}

test("the Tauri authoring transport maps the registry read onto the shared seam shape", async () => {
  const { calls, transport } = recordingTransport(
    {
      read_authoring_registries: () => ({
        snippets: [{ id: "s1", body: "x", trigger: "x" }],
        math_shortcuts: [{ id: "m1", expansion: "x", aliases: ["x"] }],
        hashes: { snippets: HASH, math_shortcuts: HASH }
      })
    },
    [{ id: "builtin", body: "b", trigger: "b", built_in: true }]
  )
  const result = await transport.readRegistries()
  assert.deepEqual(calls, [["read_authoring_registries", undefined]])
  assert.deepEqual(result, {
    snippets: [
      { id: "builtin", body: "b", trigger: "b", built_in: true },
      { id: "s1", body: "x", trigger: "x" }
    ],
    math_shortcuts: [{ id: "m1", expansion: "x", aliases: ["x"] }],
    hashes: { snippets: HASH, math_shortcuts: HASH }
  })
})

test("the Tauri authoring transport sends snake_case writes and returns the content hash", async () => {
  const entries = [{ id: "s1", name: "Note" }]
  const { calls, transport } = recordingTransport({
    write_authoring_registry: () => ({ content_hash: "b".repeat(64) })
  })
  const result = await transport.writeRegistry({ registry: "snippets", entries, baseHash: HASH })
  assert.deepEqual(calls, [[
    "write_authoring_registry",
    { registry: "snippets", entries, base_hash: HASH }
  ]])
  assert.deepEqual(result, { contentHash: "b".repeat(64) })
})

test("the Tauri authoring transport refuses writes without a loaded baseline", async () => {
  const { calls, transport } = recordingTransport({})
  await assert.rejects(
    transport.writeRegistry({ registry: "snippets", entries: [], baseHash: null }),
    error => error.code === "conflict" && /reopen settings/.test(error.message)
  )
  await assert.rejects(
    transport.writeRegistry({ registry: "nope", entries: [], baseHash: HASH }),
    error => error.code === "invalid_input"
  )
  assert.deepEqual(calls, [])
})

test("the Tauri authoring transport passes backend failure codes through to the dialog", async () => {
  const { transport } = recordingTransport({
    write_authoring_registry: () => {
      throw Object.assign(new Error("Authoring settings changed outside Elef."), { code: "conflict" })
    }
  })
  await assert.rejects(
    transport.writeRegistry({ registry: "snippets", entries: [], baseHash: HASH }),
    error => error.code === "conflict"
  )
})
