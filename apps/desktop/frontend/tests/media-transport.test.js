import assert from "node:assert/strict"
import test from "node:test"
import { createMediaFetch, mediaUrlsForDeck } from "../src/media-transport.js"

const deckId = "550e8400-e29b-41d4-a716-446655440000"

test("desktop media URLs are owned by the native adapter and scoped to one deck", () => {
  assert.deepEqual(mediaUrlsForDeck({ id: deckId }), {
    previewUrl: `elef-preview://localhost/${deckId}`,
    uploadUrl: `elef-upload://localhost/${deckId}`,
    assetBaseUrl: `elefasset://localhost/${deckId}`
  })
  assert.throws(() => mediaUrlsForDeck({ id: "" }), /deck id is required/)
})

test("media fetch sends file bytes as a raw IPC body and preserves the Rails JSON result", async () => {
  const calls = []
  const fetch = createMediaFetch({
    fetchImpl: async () => assert.fail("local upload must not reach network fetch"),
    invoke: async (...args) => {
      calls.push(args)
      return { digest: "a".repeat(64), source: "![diagram](elef-asset:digest)", content_type: "image/png" }
    }
  })
  const body = new FormData()
  const pngHeader = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  body.append("file", new Blob([pngHeader], { type: "image/png" }), "diagram.png")
  body.append("fit", "cover")

  const response = await fetch(`elef-upload://localhost/${deckId}`, { method: "POST", body })
  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    digest: "a".repeat(64),
    source: "![diagram](elef-asset:digest)",
    content_type: "image/png"
  })
  assert.equal(calls.length, 1)
  assert.ok(calls[0][1] instanceof Uint8Array)
  assert.deepEqual([...calls[0][1]], [...pngHeader])
  assert.equal(calls[0][2].headers["x-elef-deck-id"], deckId)
  assert.equal(calls[0][2].headers["x-elef-declared-media-type"], "image/png")
  assert.equal(calls[0][2].headers["x-elef-filename"], "diagram.png")
  assert.equal(calls[0][2].headers["x-elef-fit"], "cover")
})

test("media fetch rejects missing uploads and leaves unrelated requests untouched", async () => {
  let networkCalls = 0
  const fetch = createMediaFetch({
    invoke: async () => assert.fail("invalid upload must not reach IPC"),
    fetchImpl: async () => {
      networkCalls += 1
      return new Response("ok")
    }
  })

  const invalid = await fetch(`elef-upload://localhost/${deckId}`, { method: "POST", body: new FormData() })
  assert.equal(invalid.status, 400)
  assert.equal(networkCalls, 0)
  assert.equal(await (await fetch("https://example.invalid/")).text(), "ok")
  assert.equal(networkCalls, 1)
})
