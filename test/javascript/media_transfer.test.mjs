import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/media_controller.js", import.meta.url), "utf8"))
  .replace(/^import\s+{[^}]+}\s+from\s+["']@hotwired\/stimulus["'];?\n/m, "class Controller {}\n")
const mediaModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

const { isMediaTransferTypes, urlFromTransfer, imageTypeForFilename } = mediaModule

test("isMediaTransferTypes recognizes OS file drops across browsers", () => {
  assert.equal(isMediaTransferTypes(["Files"]), true)
  assert.equal(isMediaTransferTypes(["application/x-moz-file", "Files"]), true)
  assert.equal(isMediaTransferTypes(["public.url"]), true)
})

test("isMediaTransferTypes recognizes web image and URL drops", () => {
  assert.equal(isMediaTransferTypes(["text/uri-list", "text/html"]), true)
  assert.equal(isMediaTransferTypes(["text/uri-list"]), true)
  assert.equal(isMediaTransferTypes(["image/png"]), true)
})

test("isMediaTransferTypes ignores text-only drag-and-drop to preserve editor typing and drag-select", () => {
  assert.equal(isMediaTransferTypes(["text/plain", "text/html"]), false)
  assert.equal(isMediaTransferTypes(["text/plain"]), false)
  assert.equal(isMediaTransferTypes([]), false)
  assert.equal(isMediaTransferTypes(null), false)
  assert.equal(isMediaTransferTypes(undefined), false)
})

test("isMediaTransferTypes defensively handles non-Array DOMStringList objects without .includes", () => {
  const domStringList = {
    0: "Files",
    length: 1,
    contains: (item) => item === "Files",
    item: (index) => (index === 0 ? "Files" : null)
  }
  assert.equal(isMediaTransferTypes(domStringList), true)

  const domStringListUri = {
    0: "text/uri-list",
    length: 1,
    contains: (item) => item === "text/uri-list",
    item: (index) => (index === 0 ? "text/uri-list" : null)
  }
  assert.equal(isMediaTransferTypes(domStringListUri), true)

  const domStringListText = {
    0: "text/plain",
    length: 1,
    contains: (item) => item === "text/plain",
    item: (index) => (index === 0 ? "text/plain" : null)
  }
  assert.equal(isMediaTransferTypes(domStringListText), false)
})

test("filesFromTransfer prefers the file list and reads items only as a fallback", () => {
  const media = new mediaModule.default()
  const listed = { name: "same.png" }
  const duplicate = { name: "same.png" }
  let duplicateReads = 0

  assert.deepEqual(media.filesFromTransfer({
    files: [listed],
    items: [{ kind: "file", getAsFile() { duplicateReads += 1; return duplicate } }]
  }), [listed])
  assert.equal(duplicateReads, 0)

  const fallback = { name: "fallback.png" }
  assert.deepEqual(media.filesFromTransfer({
    files: [],
    items: [
      { kind: "string", getAsFile() { throw new Error("string items are ignored") } },
      { kind: "file", getAsFile: () => null },
      { kind: "file", getAsFile: () => fallback }
    ]
  }), [fallback])
})

test("sourceDragOver accepts a DOMStringList Files transfer and marks it for copying", () => {
  const media = new mediaModule.default()
  const surface = {
    classList: { classes: new Set(), add(value) { this.classes.add(value) } },
    closest() { return this }
  }
  const editor = { editingMode: "source", view: {} }
  media.element = {
    dataset: { editorMode: "source" },
    querySelector: () => ({ editorController: editor })
  }
  const types = { 0: "Files", length: 1, item: () => "Files" }
  const event = {
    currentTarget: surface,
    dataTransfer: { types, dropEffect: "none" },
    prevented: false,
    preventDefault() { this.prevented = true }
  }

  media.sourceDragOver(event)

  assert.equal(event.prevented, true)
  assert.equal(event.dataTransfer.dropEffect, "copy")
  assert.equal(surface.classList.classes.has("is-media-drop-target"), true)
})

test("pasting a file outside the editor does not intercept the event or upload it", () => {
  const media = new mediaModule.default()
  const originalDocument = globalThis.document
  const editor = { editingMode: "source", view: {}, selectionStart: 0, selectionEnd: 0 }
  let uploadAttempts = 0
  globalThis.document = { activeElement: null }
  media.element = {
    dataset: { editorMode: "source" },
    querySelector: () => ({ editorController: editor })
  }
  media.upload = () => { uploadAttempts += 1 }
  const event = {
    target: { closest: () => null },
    clipboardData: { files: [{ name: "title-paste.png" }], items: [] },
    prevented: false,
    preventDefault() { this.prevented = true }
  }

  try {
    media.paste(event)
    assert.equal(event.prevented, false)
    assert.equal(uploadAttempts, 0)
  } finally {
    globalThis.document = originalDocument
  }
})

test("urlFromTransfer extracts URLs from text/uri-list including comments", () => {
  const transfer = {
    getData: (type) => (type === "text/uri-list" ? "# comment line\r\nhttps://example.com/photo.png\r\nhttps://example.com/other.png" : "")
  }
  assert.equal(urlFromTransfer(transfer), "https://example.com/photo.png")
})

test("urlFromTransfer extracts image source from HTML markup", () => {
  const transfer = {
    getData: (type) => (type === "text/html" ? '<div class="preview"><img src="https://example.com/preview.png" alt="Preview"></div>' : "")
  }
  assert.equal(urlFromTransfer(transfer), "https://example.com/preview.png")
})

test("urlFromTransfer prefers img src over link href when image is wrapped in anchor", () => {
  const transfer = {
    getData: (type) => {
      if (type === "text/uri-list") return "https://example.com/article"
      if (type === "text/html") return '<a href="https://example.com/article"><img src="https://example.com/photo.png"></a>'
      return ""
    }
  }
  assert.equal(urlFromTransfer(transfer), "https://example.com/photo.png")
})

test("urlFromTransfer extracts plain text URLs", () => {
  const transfer = {
    getData: (type) => (type === "text/plain" ? "https://example.com/logo.webp" : "")
  }
  assert.equal(urlFromTransfer(transfer), "https://example.com/logo.webp")
})

test("urlFromTransfer ignores non-URL plain text", () => {
  const transfer = {
    getData: (type) => (type === "text/plain" ? "Just ordinary notes." : "")
  }
  assert.equal(urlFromTransfer(transfer), null)
  assert.equal(urlFromTransfer(null), null)
})

test("imageTypeForFilename detects common image extensions", () => {
  assert.equal(imageTypeForFilename("photo.png"), "image/png")
  assert.equal(imageTypeForFilename("photo.jpg"), "image/jpeg")
  assert.equal(imageTypeForFilename("photo.jpeg"), "image/jpeg")
  assert.equal(imageTypeForFilename("photo.webp"), "image/webp")
  assert.equal(imageTypeForFilename("vector.svg"), "image/svg+xml")
  assert.equal(imageTypeForFilename("animation.gif"), "image/gif")
  assert.equal(imageTypeForFilename("document.pdf"), null)
  assert.equal(imageTypeForFilename("notes.txt"), null)
  assert.equal(imageTypeForFilename(""), null)
})
