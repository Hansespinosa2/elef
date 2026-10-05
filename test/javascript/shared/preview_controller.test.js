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

test("a stranded stale preview offers retry when no replacement request remains", async () => {
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  let resolveResponse
  const statusTarget = { textContent: "Updating preview…" }
  const retryTarget = { hidden: true }
  const warnings = []
  const controller = new preview.default()
  Object.assign(controller, {
    element: { dispatchEvent() {}, querySelector: () => ({ editorController: { sourceValue: "# Notes" } }) },
    containerTarget: { setAttribute() {} },
    statusTarget,
    retryTarget,
    hasStatusTarget: true,
    hasRetryTarget: true,
    requestFields: [{ name: "document[source]", value: "# Notes" }],
    requestId: 1,
    active: true,
    projectionFresh: false,
    pendingProjection: null,
    timer: null,
    urlValue: "/documents/1/preview",
    renderWarnings: values => warnings.push(...values)
  })

  globalThis.fetch = () => new Promise(resolve => { resolveResponse = resolve })
  globalThis.document = { querySelector: () => null, activeElement: { closest: () => null } }
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.options = options } }

  try {
    const request = controller.refresh(1)
    await Promise.resolve()
    controller.requestId = 2
    resolveResponse({ ok: true, json: async () => ({ html: "<p>Old preview</p>", warnings: [] }) })

    assert.equal(await request, false)
    assert.equal(retryTarget.hidden, false)
    assert.equal(statusTarget.textContent, "Preview unavailable")
    assert.match(warnings.join(" "), /request stopped before it finished/i)
    assert.equal(controller.requestController, null)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})
