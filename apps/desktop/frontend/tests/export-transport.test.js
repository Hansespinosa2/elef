import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { buildPptxModel } from "@elef/client/pptx-model"
import { createDesktopPrepareMedia, createExportTransport } from "../src/export-transport.js"
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
  assert.equal(seen.engineSeams.libraryUrl, "./assets/pptxgen.bundle.js")
  assert.equal(typeof seen.engineSeams.prepareMedia, "function")
})

test("the export transport honors a custom generator library URL", async () => {
  const seen = {}
  const transport = createExportTransport({
    invoke: async (command) => (command === "list_media" ? [] : true),
    libraryUrl: "https://example.com/pptx.js",
    ...fakeSeams(seen)
  })

  await transport.exportPresentationPptx("work-1", { title: "Talk", source: "# Talk" })

  assert.equal(seen.engineSeams.libraryUrl, "https://example.com/pptx.js")
  assert.equal(typeof seen.engineSeams.prepareMedia, "function")
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

const PIXEL_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkWQAAAAASUVORK5CYII="

function fakeMediaElement(tagName, src) {
  return {
    tagName,
    src,
    decoded: false,
    getAttribute: (name) => (name === "src" ? src : null),
    decode: async function () { this.decoded = true }
  }
}

function fakeStage(elements) {
  return {
    querySelectorAll: (selector) => (selector.includes("katex") ? [] : elements),
    ownerDocument: undefined
  }
}

test("desktop prepareMedia resolves local assets through IPC and passes data URIs through", async () => {
  const calls = []
  const local = fakeMediaElement("IMG", `elefasset://localhost/work-1/${DIGEST}`)
  const localHttp = fakeMediaElement("IMG", `http://elefasset.localhost/work-1/${DIGEST}`)
  const duplicate = fakeMediaElement("IMG", `elefasset://localhost/work-1/${DIGEST}`)
  const clip = fakeMediaElement("VIDEO", `elefasset://localhost/work-1/${"b".repeat(64)}`)
  const inline = fakeMediaElement("IMG", PIXEL_DATA_URI)
  const prepareMedia = createDesktopPrepareMedia({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "read_pptx_asset") {
        return payload.digest === DIGEST ? PIXEL_DATA_URI : "data:video/mp4;base64,AAAA"
      }
      throw new Error(`unexpected command ${command}`)
    },
    workId: "work-1"
  })

  const assets = await prepareMedia(fakeStage([local, localHttp, duplicate, clip, inline]))

  assert.deepEqual(calls, [
    ["read_pptx_asset", { id: "work-1", digest: DIGEST }],
    ["read_pptx_asset", { id: "work-1", digest: DIGEST }],
    ["read_pptx_asset", { id: "work-1", digest: "b".repeat(64) }]
  ])
  assert.equal(assets.media.size, 5)
  assert.equal(assets.media.get(local).data, PIXEL_DATA_URI)
  assert.equal(assets.media.get(local).contentType, "image/png")
  assert.equal(assets.media.get(clip).contentType, "video/mp4")
  assert.equal(assets.media.get(inline).data, PIXEL_DATA_URI)
  for (const element of [local, localHttp, duplicate, clip, inline]) {
    assert.match(element.src, /^blob:/)
  }
  assert.equal(local.decoded, true)
  assert.equal(clip.decoded, false)
  assert.equal(assets.objectUrls.length, 5)
})

test("desktop prepareMedia routes remote images through the policy command", async () => {
  const calls = []
  const https = fakeMediaElement("IMG", "https://example.com/pic.png")
  const protocolRelative = fakeMediaElement("IMG", "//cdn.example.com/pic.png")
  const prepareMedia = createDesktopPrepareMedia({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      if (command === "fetch_remote_image") return PIXEL_DATA_URI
      throw new Error(`unexpected command ${command}`)
    },
    workId: "work-1"
  })

  const assets = await prepareMedia(fakeStage([https, protocolRelative]))

  assert.deepEqual(calls, [
    ["fetch_remote_image", { url: "https://example.com/pic.png" }],
    ["fetch_remote_image", { url: "https://cdn.example.com/pic.png" }]
  ])
  assert.equal(assets.media.size, 2)
})

test("desktop prepareMedia rejects unresolvable media without invoking", async () => {
  let invoked = 0
  const prepareMedia = createDesktopPrepareMedia({
    invoke: async () => {
      invoked += 1
      throw new Error("invoke must not run")
    },
    workId: "work-1"
  })

  await assert.rejects(
    prepareMedia(fakeStage([fakeMediaElement("IMG", "images/relative.png")])),
    /could not be loaded/
  )
  await assert.rejects(
    prepareMedia(fakeStage([fakeMediaElement("IMG", "elefasset://localhost/work-1/not-a-digest")])),
    /could not be loaded/
  )
  assert.equal(invoked, 0)
})

test("desktop prepareMedia enforces the per-export remote total with the server message", async () => {
  const prepareMedia = createDesktopPrepareMedia({
    invoke: async (command) => {
      if (command === "fetch_remote_image") return PIXEL_DATA_URI
      if (command === "read_pptx_asset") return PIXEL_DATA_URI
      throw new Error(`unexpected command ${command}`)
    },
    workId: "work-1",
    remoteImagesCap: 10
  })

  await assert.rejects(
    prepareMedia(fakeStage([fakeMediaElement("IMG", "https://example.com/a.png")])),
    /Linked images exceed the 30 MB PPTX export limit/
  )
  // Local and inline bytes never count toward the remote total.
  const localOnly = await prepareMedia(fakeStage([
    fakeMediaElement("IMG", `elefasset://localhost/work-1/${DIGEST}`),
    fakeMediaElement("IMG", PIXEL_DATA_URI)
  ]))
  assert.equal(localOnly.media.size, 2)
})

test("the export transport builds the real shared model for a deck with local and remote images", async () => {
  const seen = {}
  const transport = createExportTransport({
    invoke: async (command, payload) => {
      if (command === "list_media") return [{ digest: DIGEST, content_type: "image/png" }]
      if (command === "save_pptx_bytes") {
        seen.saved = payload
        return true
      }
      throw new Error(`unexpected command ${command}`)
    },
    modelBuilder: buildPptxModel,
    engine: async (model, seams) => {
      seen.engineModel = model
      seen.prepareMedia = seams.prepareMedia
      return fakeBlob([9, 9, 9])
    }
  })
  const source = `# Talk\n\n![Local](elef-asset:${DIGEST})\n\n![Remote](https://example.com/pic.png)\n`

  const saved = await transport.exportPresentationPptx("work-1", { title: "Talk", source })

  assert.equal(saved, true)
  assert.equal(seen.engineModel.filename, "Talk.pptx")
  const html = seen.engineModel.slides.flatMap((slide) => slide.blocks.map((block) => block.html)).join("\n")
  assert.match(html, new RegExp(`elefasset://localhost/work-1/${DIGEST}`))
  assert.match(html, /https:\/\/example\.com\/pic\.png/)
  assert.deepEqual(seen.saved, { filename: "Talk.pptx", bytes: [9, 9, 9] })
  assert.equal(typeof seen.prepareMedia, "function")
})

test("the wired prepareMedia resolves real model markup through IPC only", async () => {
  const seen = {}
  const transport = createExportTransport({
    invoke: async (command) => {
      if (command === "list_media") return [{ digest: DIGEST, content_type: "image/png" }]
      if (command === "save_pptx_bytes") return true
      throw new Error(`unexpected command ${command}`)
    },
    modelBuilder: buildPptxModel,
    engine: async (model, seams) => {
      seen.engineModel = model
      seen.prepareMedia = seams.prepareMedia
      return fakeBlob([9, 9, 9])
    }
  })
  await transport.exportPresentationPptx("work-1", {
    title: "Talk",
    source: `# Talk\n\n![Local](elef-asset:${DIGEST})\n\n![Remote](https://example.com/pic.png)\n`
  })

  const html = seen.engineModel.slides.flatMap((slide) => slide.blocks.map((block) => block.html)).join("\n")
  const { document } = parseHTML(`<div id="stage">${html}</div>`)
  const stage = document.querySelector("#stage")
  // linkedom lacks media loading: decode what the seam needs.
  for (const image of stage.querySelectorAll("img[src]")) image.decode = async () => {}
  const calls = []
  const resolving = createDesktopPrepareMedia({
    invoke: async (command, payload) => {
      calls.push([command, payload])
      return PIXEL_DATA_URI
    },
    workId: "work-1"
  })
  const assets = await resolving(stage)

  assert.equal(assets.media.size, 2)
  assert.deepEqual(calls, [
    ["read_pptx_asset", { id: "work-1", digest: DIGEST }],
    ["fetch_remote_image", { url: "https://example.com/pic.png" }]
  ])
  assert.equal(typeof seen.prepareMedia, "function")
})
