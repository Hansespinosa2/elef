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
