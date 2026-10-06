import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

const saveFlowSource = await readFile(new URL("../../app/javascript/lib/save_flow.js", import.meta.url), "utf8")
const saveFlowUrl = `data:text/javascript;base64,${Buffer.from(saveFlowSource).toString("base64")}`
const conflictDialogSource = await readFile(new URL("../../app/javascript/lib/conflict_dialog.js", import.meta.url), "utf8")
const conflictDialogUrl = `data:text/javascript;base64,${Buffer.from(conflictDialogSource).toString("base64")}`
const source = (await readFile(new URL("../../app/javascript/controllers/autosave_controller.js", import.meta.url), "utf8"))
  .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  .replace('import { createSaveFlow } from "lib/save_flow"', `const { createSaveFlow } = await import("${saveFlowUrl}")`)
  .replace('import { presentConflictDialog } from "lib/conflict_dialog"', `const { presentConflictDialog } = await import("${conflictDialogUrl}")`)
  .replace('import { editorFor } from "lib/editor_controller_lookup"', "const editorFor = () => null")
  .replace('import { applyEditorSource } from "lib/editor_source"', "const applyEditorSource = async () => true")
  .replace('import { waitForEditorController } from "lib/editor_ready"', "const waitForEditorController = async () => null")
const autosave = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("the Rails transport saves the live editor source without requesting a source commit", async () => {
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
    dispatchEvent(event) { dispatchedEvents.push(event.type) },
    querySelector: (selector) => selector === ".source-field" ? sourceField : null,
  }
  const controller = new autosave.default()
  Object.assign(controller, {
    element: form,
    fieldTargets: [sourceField],
    active: true,
    saveEnabledValue: true,
    timeoutValue: 10000,
    persistLocalDraft: async () => true,
    updateRevisionTokens: () => {},
    setStatus: () => {},
    synchronizeCanonicalSource: () => {},
    currentSource: () => sourceField.value,
    sourceField: () => sourceField
  })

  const originalFetch = globalThis.fetch
  const originalFormData = globalThis.FormData
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ source: "$x.b$" }) })
  globalThis.FormData = class {
    constructor() { this.values = new Map() }
    set(name, value) { this.values.set(name, value) }
  }
  globalThis.document = { querySelector: () => null }
  globalThis.CustomEvent = class { constructor(type) { this.type = type } }

  try {
    const result = await controller.saveToRails("deck-1", "$x.b$")
    assert.equal(result.source, "$x.b$")
    assert.equal(result.snapshot, "$x.b$")
  } finally {
    globalThis.fetch = originalFetch
    globalThis.FormData = originalFormData
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }

  assert.equal(sourceField.value, "$x.b$")
  assert.equal(dispatchedEvents.includes("elef:before-save"), false)
})

test("Rails autosave uses the shared state machine for source and metadata snapshots", async () => {
  const sourceField = { name: "presentation[source]", value: "# Start" }
  const titleField = { name: "presentation[title]", value: "Start" }
  const calls = []
  const controller = new autosave.default()
  Object.assign(controller, {
    delayValue: 1000,
    fieldTargets: [sourceField, titleField],
    currentSource: () => sourceField.value,
    snapshot: () => [sourceField.value, titleField.value].join("\u001f"),
    saveToRails: async (value, snapshot) => {
      calls.push({ value, snapshot })
      return { content_hash: "next-version", source: value, snapshot }
    },
    acceptDiskVersion() {},
    applyExternalSource: async () => true,
    handleSaveState() {},
    handleSaveConflict() {},
    materializeEditorEdits() {}
  })
  controller.flow = controller.createSaveFlow()
  const deck = { id: "presentation-1", source: sourceField.value, content_hash: "revision-1" }
  controller.flow.activate(deck)
  titleField.value = "Updated title"
  controller.flow.noteChange()

  assert.equal(await controller.flow.flush({ force: true }), true)
  assert.deepEqual(calls, [{ value: "# Start", snapshot: "# Start\u001fUpdated title" }])
  assert.equal(controller.flow.dirty, false)
  assert.equal(deck.savedSnapshot, "# Start\u001fUpdated title")
})

test("Rails revision conflicts resolve through the shared flow without requiring a file hash", async () => {
  const sourceField = { name: "document[source]", value: "original" }
  const titleField = { name: "document[title]", value: "Initial title" }
  const themeField = { name: "document[theme]", value: "light" }
  const typographyField = { name: "document[typography]", value: "book" }
  const accepted = []
  const controller = new autosave.default()
  Object.assign(controller, {
    delayValue: 1000,
    fieldTargets: [sourceField, titleField, themeField, typographyField],
    currentSource: () => sourceField.value,
    snapshot: () => [sourceField.value, titleField.value, themeField.value, typographyField.value].join("\u001f"),
    saveToRails: async () => {
      throw Object.assign(new Error("The work changed."), {
        code: "conflict",
        details: {
          message: "The work changed.",
          current: { source: "disk", title: "Disk title", theme: null, typography: "technical", revision_token: "opaque-revision-2", lock_version: 2 }
        }
      })
    },
    updateRevisionTokens: current => accepted.push(current.revision_token),
    applyExternalSource: async source => {
      sourceField.value = source
      titleField.value = "Disk title"
      themeField.value = ""
      typographyField.value = "technical"
      return true
    },
    handleSaveState() {},
    handleSaveConflict(conflict) {
      this.conflictPayload = { current: conflict.current, message: conflict.message }
    },
    materializeEditorEdits() {}
  })
  controller.flow = controller.createSaveFlow()
  controller.flow.activate({ id: "document-1", source: "original", content_hash: "opaque-revision-1" })
  sourceField.value = "local"
  titleField.value = "Local title"
  controller.flow.noteChange()

  assert.equal(await controller.flow.flush({ force: true }), false)
  assert.equal(controller.flow.conflict.diskHash, "opaque-revision-2")
  assert.equal(await controller.flow.useDiskVersion(), true)
  assert.equal(sourceField.value, "disk")
  assert.equal(titleField.value, "Disk title")
  assert.equal(themeField.value, "")
  assert.equal(typographyField.value, "technical")
  assert.deepEqual(accepted, ["opaque-revision-2"])
  assert.equal(controller.flow.dirty, false)
})

test("merged Rails text saves local metadata against the disk metadata baseline", async () => {
  const sourceField = { name: "presentation[source]", value: "original" }
  const titleField = { name: "presentation[title]", value: "Initial title" }
  const calls = []
  let conflictOnce = true
  const controller = new autosave.default()
  Object.assign(controller, {
    delayValue: 1000,
    fieldTargets: [sourceField, titleField],
    currentSource: () => sourceField.value,
    snapshot: () => [sourceField.value, titleField.value].join("\u001f"),
    saveToRails: async (source, snapshot) => {
      calls.push({ source, snapshot })
      if (conflictOnce) {
        conflictOnce = false
        throw Object.assign(new Error("The work changed."), {
          code: "conflict",
          details: {
            message: "The work changed.",
            current: { source: "disk", title: "Disk title", revision_token: "opaque-revision-2" }
          }
        })
      }
      return { content_hash: "opaque-revision-3", source, snapshot }
    },
    updateRevisionTokens() {},
    applyExternalSource: async (source, { preserveMetadata = false } = {}) => {
      sourceField.value = source
      if (!preserveMetadata) titleField.value = "Disk title"
      return true
    },
    handleSaveState() {},
    handleSaveConflict(conflict) {
      this.conflictPayload = { current: conflict.current, message: conflict.message }
    },
    materializeEditorEdits() {}
  })
  controller.flow = controller.createSaveFlow()
  controller.flow.activate({ id: "presentation-1", source: "original", content_hash: "opaque-revision-1" })
  sourceField.value = "local"
  titleField.value = "Local title"
  controller.flow.noteChange()

  assert.equal(await controller.flow.flush({ force: true }), false)
  assert.equal(await controller.flow.saveMergedVersion("disk"), true)
  assert.equal(await controller.flow.flush({ force: true }), true)
  assert.deepEqual(calls, [
    { source: "local", snapshot: "local\u001fLocal title" },
    { source: "disk", snapshot: "disk\u001fLocal title" }
  ])
  assert.equal(controller.flow.dirty, false)
})

test("a style-only Rails conflict still saves local appearance overrides after merging unchanged text", async () => {
  const fields = [
    { name: "presentation[source]", value: "same source" },
    { name: "presentation[title]", value: "Deck" },
    { name: "presentation[theme]", value: "" },
    { name: "presentation[typography]", value: "" }
  ]
  const calls = []
  let conflictOnce = true
  const controller = new autosave.default()
  Object.assign(controller, {
    delayValue: 1000,
    fieldTargets: fields,
    currentSource: () => fields[0].value,
    snapshot: () => fields.map(field => field.value).join("\u001f"),
    saveToRails: async (source, snapshot) => {
      calls.push({ source, snapshot })
      if (conflictOnce) {
        conflictOnce = false
        throw Object.assign(new Error("The work changed."), {
          code: "conflict",
          details: {
            message: "The work changed.",
            current: { source: "same source", title: "Deck", theme: "dark", typography: "technical", revision_token: "opaque-revision-2" }
          }
        })
      }
      return { content_hash: "opaque-revision-3", source, snapshot }
    },
    updateRevisionTokens() {},
    applyExternalSource: async (source, { preserveMetadata = false } = {}) => {
      fields[0].value = source
      if (!preserveMetadata) {
        fields[1].value = "Deck"
        fields[2].value = "dark"
        fields[3].value = "technical"
      }
      return true
    },
    handleSaveState() {},
    handleSaveConflict(conflict) {
      this.conflictPayload = { current: conflict.current, message: conflict.message }
    },
    materializeEditorEdits() {}
  })
  controller.flow = controller.createSaveFlow()
  controller.flow.activate({ id: "presentation-1", source: "same source", content_hash: "opaque-revision-1" })
  fields[2].value = "light"
  controller.flow.noteChange()

  assert.equal(await controller.flow.flush({ force: true }), false)
  assert.equal(await controller.flow.saveMergedVersion("same source"), true)
  assert.equal(await controller.flow.flush({ force: true }), true)
  assert.deepEqual(calls, [
    { source: "same source", snapshot: "same source\u001fDeck\u001flight\u001f" },
    { source: "same source", snapshot: "same source\u001fDeck\u001flight\u001f" }
  ])
  assert.equal(controller.flow.dirty, false)
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

test("autosave conflict review presents both byte versions and starts the merge with local text", () => {
  const nodes = new Map([
    ["#conflict-message", { textContent: "" }],
    ["#conflict-local", { textContent: "" }],
    ["#conflict-disk", { textContent: "" }],
    ["#conflict-source-name", { textContent: "" }],
    ["#conflict-merge", { value: "" }]
  ])
  const dialog = { open: false, querySelector(selector) { return nodes.get(selector) }, showModal() { this.open = true } }
  const sourceField = { value: "local <draft>" }
  const controller = new autosave.default()
  Object.assign(controller, {
    element: { querySelector: () => sourceField },
    hasConflictTarget: true,
    conflictTarget: dialog,
    hasConflictMessageTarget: true,
    hasLocalSourceTarget: true,
    hasServerSourceTarget: true,
    hasMergeSourceTarget: true
  })

  controller.showConflict({ message: "A newer version is active.", current: { source: "disk <edit>" } })

  assert.equal(dialog.open, true)
  assert.equal(nodes.get("#conflict-local").textContent, "local <draft>")
  assert.equal(nodes.get("#conflict-disk").textContent, "disk <edit>")
  assert.equal(nodes.get("#conflict-merge").value, "local <draft>")
  assert.equal(nodes.get("#conflict-message").textContent, "A newer version is active.")
})

test("autosave delegates merged conflict text to the shared save flow", () => {
  const controller = new autosave.default()
  let merged = null
  controller.flow = {
    conflict: { diskSource: "disk" },
    saveMergedVersion(value) { merged = value; return true }
  }
  Object.assign(controller, {
    hasMergeSourceTarget: true,
    mergeSourceTarget: { value: "combined" }
  })

  assert.equal(controller.saveMergedVersion(), true)
  assert.equal(merged, "combined")
})
