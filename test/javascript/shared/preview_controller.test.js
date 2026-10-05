import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const source = (await readFile(path.join(root, "app/javascript/controllers/preview_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace(
    'import { installPreviewHtml } from "lib/editor_view"',
    `import { installPreviewHtml } from "${pathToFileURL(path.join(root, "app/javascript/lib/editor_view.js")).href}"`
  )
  .replace(
    'import { buildPreviewRequestBody } from "lib/preview_request_body"',
    `import { buildPreviewRequestBody } from "${pathToFileURL(path.join(root, "app/javascript/lib/preview_request_body.js")).href}"`
  )
const preview = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("preview timeout also bounds reading the JSON response body", async () => {
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  let requestSignal
  let status = ""
  let retryShown = false
  let installed = false
  const warnings = []
  const sourceField = { name: "document[source]", value: "# Notes" }
  const controller = new preview.default()
  Object.assign(controller, {
    element: {
      dispatchEvent() {},
      querySelector: selector => selector === ".source-field" ? { editorController: { sourceValue: "# Notes" } } : null
    },
    containerTarget: { setAttribute() {} },
    requestFields: [sourceField],
    requestId: 1,
    active: true,
    timeoutValue: 10,
    urlValue: "/documents/1/preview",
    renderWarnings: values => warnings.push(...values),
    showRetry: () => { retryShown = true },
    setStatus: value => { status = value },
    installProjection: () => { installed = true }
  })

  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return { ok: true, json: () => new Promise(() => {}) }
  }
  globalThis.document = { querySelector: () => null, activeElement: { closest: () => null } }
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.options = options } }

  try {
    const stillPending = Symbol("still pending")
    const result = await Promise.race([
      controller.refresh(1),
      new Promise(resolve => setTimeout(() => resolve(stillPending), 200))
    ])

    assert.notEqual(result, stillPending, "refresh stayed pending after its timeout")
    assert.equal(result, false)
    assert.equal(requestSignal.aborted, true)
    assert.equal(status, "Preview unavailable")
    assert.equal(retryShown, true)
    assert.equal(installed, false)
    assert.match(warnings.join(" "), /Preview timed out/)
    assert.equal(controller.requestController, null)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})
