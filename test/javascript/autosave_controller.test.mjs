import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const source = (await readFile(new URL("../../app/javascript/controllers/autosave_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
const autosave = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("autosave persists active math shorthand without requesting a source commit", async () => {
  const dispatchedEvents = []
  const sourceField = {
    value: "$x.b$",
    dispatchEvent(event) {
      dispatchedEvents.push(event.type)
      if (event.type === "elef:before-save") this.value = "$\\mathbf{x}$"
    }
  }
  const form = {
    action: "/documents/1/autosave",
    querySelector: (selector) => selector === ".source-field" ? sourceField : null,
    dispatchEvent(event) { dispatchedEvents.push(event.type) }
  }
  const controller = new autosave.default()
  Object.assign(controller, {
    element: form,
    fieldTargets: [sourceField],
    timer: null,
    timerGeneration: 0,
    saving: false,
    active: true,
    saveEnabledValue: true,
    persistLocalDraft: async () => true,
    updateRevisionTokens: () => {},
    setStatus: () => {},
    synchronizeCanonicalSource: () => {},
    clearLocalDraft: () => {}
  })

  const originalFetch = globalThis.fetch
  const originalFormData = globalThis.FormData
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ source: "$x.b$" }) })
  globalThis.FormData = class { constructor() {} }
  globalThis.document = { querySelector: () => null }
  globalThis.CustomEvent = class { constructor(type) { this.type = type } }

  try {
    await controller.save()
  } finally {
    globalThis.fetch = originalFetch
    globalThis.FormData = originalFormData
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }

  assert.equal(sourceField.value, "$x.b$")
  assert.equal(controller.savedSnapshot, "$x.b$")
  assert.equal(dispatchedEvents.includes("elef:before-save"), false)
})

function draftRecoveryFixture() {
  const sourceField = {
    name: "presentation[source]",
    value: "# Original",
    dispatched: [],
    dispatchEvent(event) { this.dispatched.push(event.type) }
  }
  const listeners = new Map()
  const editorHost = {
    editorController: null,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    }
  }
  const status = []
  const controller = new autosave.default()
  Object.assign(controller, {
    active: true,
    localDraftKey: "presentation:1:identity",
    freshNewWorkNavigation: false,
    fieldTargets: [sourceField],
    element: { querySelector: selector => selector === ".source-field" ? editorHost : null },
    readDraft: async () => ({
      key: "presentation:1:identity",
      snapshot: "# Offline edit",
      values: ["# Offline edit"],
      updatedAt: 1
    }),
    clearSaveTimer() {},
    scheduleSave() {},
    setStatus: text => status.push(text)
  })

  return { controller, editorHost, listeners, sourceField, status }
}

test("draft recovery waits for the live editor before restoring source input", async () => {
  const { controller, editorHost, listeners, sourceField, status } = draftRecoveryFixture()
  const restoring = controller.restoreLocalDraft()
  await Promise.resolve()
  assert.equal(controller.editorReadyCleanup instanceof Function, true)
  assert.equal(sourceField.value, "# Original")

  editorHost.editorController = {}
  listeners.get("elef:editor-ready")()
  await restoring

  assert.equal(sourceField.value, "# Offline edit")
  assert.deepEqual(sourceField.dispatched, ["input"])
  assert.deepEqual(status, ["Recovered unsent changes"])
  assert.equal(controller.editorReadyCleanup, null)
})

test("draft recovery leaves edits made while the editor connects untouched", async () => {
  const { controller, editorHost, listeners, sourceField, status } = draftRecoveryFixture()
  const restoring = controller.restoreLocalDraft()
  await Promise.resolve()

  sourceField.value = "# New user edit"
  editorHost.editorController = {}
  listeners.get("elef:editor-ready")()
  await restoring

  assert.equal(sourceField.value, "# New user edit")
  assert.deepEqual(sourceField.dispatched, [])
  assert.deepEqual(status, [])
})
