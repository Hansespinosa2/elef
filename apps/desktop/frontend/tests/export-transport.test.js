import assert from "node:assert/strict"
import test from "node:test"

import { createExportTransport } from "../src/export-transport.js"
import { createBaseFileLibraryTransport } from "../src/file-library-transport-base.js"
import { createFileLibraryTransport } from "../src/file-library-transport.js"
import { createFileLibraryTransport as createStableFileLibraryTransport } from "../src/file-library-transport-stable.js"

const DIGEST = "a".repeat(64)

function fakeBlob(bytes) {
  return { arrayBuffer: async () => new Uint8Array(bytes).buffer }
}

function fakeSeams(seen) {
  return {
    modelBuilder: async (input) => {
      seen.modelInput = input
      return { filename: "Talk.pptx", slides: [] }
    },
    engine: async (model, seams) => {
      seen.engineModel = model
      seen.engineSeams = seams
      return fakeBlob([1, 2, 3])
    }
  }
}

test("the export transport requires an invoke transport", () => {
  assert.throws(() => createExportTransport(), /invoke transport/)
  assert.throws(() => createExportTransport({}), /invoke transport/)
})

test("the export transport builds the shared model, renders it, and saves bytes natively", async () => {
  const calls = []
  const seen = {}
  const transport = createExportTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "list_media") {
        return [
          { digest: DIGEST, content_type: "image/png" },
          { digest: "bogus", content_type: "image/png" }
        ]
      }
      if (command === "save_pptx_bytes") return true
      throw new Error(`unexpected command ${command}`)
    },
    ...fakeSeams(seen)
  })

  const saved = await transport.exportPresentationPptx("work-1", { title: "Talk", source: "# Talk" })

  assert.equal(saved, true)
  assert.deepEqual(calls, [
    ["list_media", { id: "work-1" }],
    ["save_pptx_bytes", { filename: "Talk.pptx", bytes: [1, 2, 3] }]
  ])
  assert.deepEqual(seen.modelInput, {
    source: "# Talk",
    title: "Talk",
    mediaMap: {
      [`elef-asset:${DIGEST}`]: {
        src: `elefasset://localhost/work-1/${DIGEST}`,
        contentType: "image/png"
      }
    }
  })
  assert.equal(seen.engineModel.filename, "Talk.pptx")
  assert.deepEqual(seen.engineSeams, { libraryUrl: "./assets/pptxgen.bundle.js" })
})

test("the export transport honors a custom generator library URL", async () => {
  const seen = {}
  const transport = createExportTransport({
    invoke: async (command) => (command === "list_media" ? [] : true),
    libraryUrl: "https://example.com/pptx.js",
    ...fakeSeams(seen)
  })

  await transport.exportPresentationPptx("work-1", { title: "Talk", source: "# Talk" })

  assert.deepEqual(seen.engineSeams, { libraryUrl: "https://example.com/pptx.js" })
})

test("the export transport refuses to export without a work or source", async () => {
  const transport = createExportTransport({
    invoke: async () => {
      throw new Error("invoke must not run")
    },
    ...fakeSeams({})
  })

  await assert.rejects(transport.exportPresentationPptx("", { title: "Talk", source: "# Talk" }), /Open a Work/)
  await assert.rejects(transport.exportPresentationPptx("work-1", { title: "Talk" }), /source is unavailable/)
})

test("both file library transports expose the PPTX export seam", async () => {
  const calls = []
  const seen = {}
  const transport = createBaseFileLibraryTransport({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "list_media") return []
      if (command === "save_pptx_bytes") return false
      throw new Error(`unexpected command ${command}`)
    },
    pptxSeams: fakeSeams(seen)
  })

  const saved = await transport.exportPptx("work-9", { title: "Deck", source: "# Deck" })

  assert.equal(saved, false)
  assert.deepEqual(calls, [
    ["list_media", { id: "work-9" }],
    ["save_pptx_bytes", { filename: "Talk.pptx", bytes: [1, 2, 3] }]
  ])
  assert.equal(typeof createFileLibraryTransport({ invoke: async () => ({}) }).exportPptx, "function")
  assert.equal(typeof createStableFileLibraryTransport({ invoke: async () => ({}) }).exportPptx, "function")
})
