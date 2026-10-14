import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
const source = (await readFile(path.join(root, "packages/editor-runtime/dist/controllers/preview_controller.js"), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace(
    'import { installPreviewHtml } from "../lib/editor_view.js"',
    `import { installPreviewHtml } from "${pathToFileURL(path.join(root, "packages/editor-runtime/dist/lib/editor_view.js")).href}"`
  )
  .replace(
    'import { buildPreviewRequestBody } from "../lib/preview_request_body.js"',
    `import { buildPreviewRequestBody } from "${pathToFileURL(path.join(root, "packages/editor-runtime/dist/lib/preview_request_body.js")).href}"`
  )
  .replace(
    'import { attachCanvasScaling } from "@elef/client"',
    `import { attachCanvasScaling } from "${import.meta.resolve("@elef/client")}"`
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
      dataset: {},
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

test("finishEditing blurs a focused visual projection block", () => {
  const originalDocument = globalThis.document
  const controller = new preview.default()
  let blurred = false
  const activeEditable = {
    blur: () => { blurred = true },
    closest: selector => selector === "[contenteditable='true']" ? activeEditable : null
  }
  const container = { contains: element => element === activeEditable }
  controller.containerTarget = container
  globalThis.document = { activeElement: activeEditable }

  try {
    assert.equal(controller.finishEditing(), true)
    assert.equal(blurred, true)
  } finally {
    globalThis.document = originalDocument
  }
})

test("finishEditing leaves focus outside the visual projection alone", () => {
  const originalDocument = globalThis.document
  const controller = new preview.default()
  let blurred = false
  const activeEditable = {
    blur: () => { blurred = true },
    closest: selector => selector === "[contenteditable='true']" ? activeEditable : null
  }
  controller.containerTarget = { contains: () => false }
  globalThis.document = { activeElement: activeEditable }

  try {
    assert.equal(controller.finishEditing(), false)
    assert.equal(blurred, false)
  } finally {
    globalThis.document = originalDocument
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

test("an aborted latest preview offers retry after its request handle is cleared", async () => {
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  let rejectResponse
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

  globalThis.fetch = () => new Promise((_resolve, reject) => { rejectResponse = reject })
  globalThis.document = { querySelector: () => null, activeElement: { closest: () => null } }
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.options = options } }

  try {
    const request = controller.refresh(1)
    await Promise.resolve()
    controller.abortActiveRequest()
    rejectResponse(Object.assign(new Error("Request aborted"), { name: "AbortError" }))

    assert.equal(await request, undefined)
    assert.equal(retryTarget.hidden, false)
    assert.equal(statusTarget.textContent, "Preview unavailable")
    assert.match(warnings.join(" "), /request stopped before it finished/i)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})

test("coalesces preview revisions behind the active render", async () => {
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  let source = "# First"
  const sourceField = { name: "document[source]", value: source }
  const requestBodies = []
  const requestSignals = []
  const resolveResponses = []
  const installedSources = []
  const statusTarget = { textContent: "Updating preview…" }
  const retryTarget = { hidden: true }
  const controller = new preview.default()
  Object.assign(controller, {
    element: {
      dataset: {},
      dispatchEvent() {},
      querySelector: selector => selector === ".source-field"
        ? { editorController: { get sourceValue() { return source } } }
        : null
    },
    containerTarget: { setAttribute() {} },
    statusTarget,
    retryTarget,
    hasStatusTarget: true,
    hasRetryTarget: true,
    requestFields: [sourceField],
    requestId: 1,
    active: true,
    projectionFresh: false,
    pendingProjection: null,
    timer: null,
    delayValue: 1,
    timeoutValue: 1000,
    urlValue: "/documents/1/preview",
    renderWarnings() {},
    installProjection: (_payload, _response, requestedSource) => {
      installedSources.push(requestedSource)
      controller.projectionFresh = true
    }
  })

  globalThis.fetch = (_url, options) => {
    requestBodies.push(options.body)
    requestSignals.push(options.signal)
    return new Promise(resolve => {
      resolveResponses.push(payload => resolve({ ok: true, json: async () => payload }))
    })
  }
  globalThis.document = { querySelector: () => null, activeElement: { closest: () => null } }
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.options = options } }

  try {
    const firstRequest = controller.refresh(1)

    source = "# Second"
    sourceField.value = source
    controller.schedule()
    source = "# Latest"
    sourceField.value = source
    controller.schedule()
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(requestBodies.length, 1, "source changes started overlapping render requests")
    assert.equal(requestSignals[0].aborted, false, "typing aborted work the backend may still be rendering")
    assert.equal(controller.queuedRequestId, 3)

    resolveResponses[0]({ html: "<p>First</p>", warnings: [] })
    assert.equal(await firstRequest, false)
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(requestBodies.length, 2, "the newest source was not rendered after the active request settled")
    assert.equal(requestBodies[1].get("document[source]"), "# Latest")
    resolveResponses[1]({ html: "<p>Latest</p>", warnings: [] })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(installedSources, ["# Latest"])
    assert.equal(controller.requestController, null)
  } finally {
    clearTimeout(controller.timer)
    controller.abortActiveRequest()
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})
