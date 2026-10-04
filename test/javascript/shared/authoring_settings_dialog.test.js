import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseHTML } from "linkedom"
import { createAuthoringSettingsDialog } from "../../../app/javascript/lib/authoring_settings_dialog.js"

const shell = await readFile(new URL("../../../app/views/desktop_shell/index.html", import.meta.url), "utf8")

function createDialog({ readRegistries, writeRegistry, reloadEditorRegistry, onSaved }) {
  const { document, Event } = parseHTML(shell)
  const elements = {
    dialog: document.querySelector("#authoring-settings-dialog"),
    title: document.querySelector("#authoring-settings-title"),
    tabs: document.querySelectorAll("[data-authoring-tab]"),
    status: document.querySelector("#authoring-settings-status"),
    count: document.querySelector("#authoring-settings-count"),
    list: document.querySelector("#authoring-settings-list"),
    empty: document.querySelector("#authoring-settings-empty"),
    newButton: document.querySelector("#new-authoring-entry"),
    form: document.querySelector("#authoring-entry-form"),
    formHeading: document.querySelector("#authoring-entry-heading"),
    snippetFields: document.querySelector(".authoring-snippet-fields"),
    mathFields: document.querySelector(".authoring-math-fields"),
    saveButton: document.querySelector("#save-authoring-entry"),
    deleteDialog: document.querySelector("#delete-authoring-dialog"),
    deleteMessage: document.querySelector("#delete-authoring-message"),
    confirmDelete: document.querySelector("#confirm-authoring-delete"),
    cancelDelete: document.querySelector("#cancel-authoring-delete"),
    cancelEntryButton: document.querySelector("#cancel-authoring-entry"),
    closeButton: document.querySelector("#close-authoring-settings")
  }
  const prefix = document.querySelector('[name="prefix"]')
  let prefixValue = prefix.querySelector("option").getAttribute("value")
  Object.defineProperty(prefix, "value", {
    configurable: true,
    get: () => prefixValue,
    set: value => { prefixValue = value }
  })
  return {
    dialog: createAuthoringSettingsDialog({ elements, readRegistries, writeRegistry, reloadEditorRegistry, onSaved }),
    document,
    Event
  }
}

test("authoring settings UI edits and deletes entries through the injected app transport", async () => {
  const writes = []
  const saved = []
  let reloads = 0
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({
      snippets: [{ id: "snippet-1", name: "Note", trigger: "note", category: "Markdown", body: "# Note" }],
      math_shortcuts: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda" }],
      hashes: { snippets: "snippets-hash", math_shortcuts: "math-hash" }
    }),
    writeRegistry: async payload => {
      writes.push(payload)
      return { contentHash: `hash-${writes.length}` }
    },
    reloadEditorRegistry: async () => { reloads += 1 },
    onSaved: message => saved.push(message)
  })

  await dialog.open()
  assert.equal(document.querySelector("#authoring-settings-count").textContent, "1 personal snippet")

  document.querySelector('[data-authoring-tab="math_shortcuts"]').dispatchEvent(new Event("click"))
  assert.equal(document.querySelector("#authoring-settings-title").textContent, "Math shortcuts")
  assert.equal(document.querySelector(".authoring-math-fields").disabled, false)
  document.querySelector(".authoring-entry-actions button:not(.authoring-delete)").dispatchEvent(new Event("click"))
  document.querySelector('[name="aliases"]').value = "Lambda, l"
  document.querySelector("#authoring-entry-form").dispatchEvent(new Event("submit", { cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(writes[0].registry, "math_shortcuts")
  assert.equal(writes[0].baseHash, "math-hash")
  assert.deepEqual(writes[0].entries[0].aliases, ["lambda", "l"])
  assert.equal(reloads, 1)
  assert.deepEqual(saved, ["Changes saved"])

  document.querySelector(".authoring-delete").dispatchEvent(new Event("click"))
  assert.match(document.querySelector("#delete-authoring-message").textContent, /Delete “Lambda”/)
  document.querySelector("#confirm-authoring-delete").dispatchEvent(new Event("click"))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(writes[1].entries, [])
  assert.deepEqual(saved, ["Changes saved", "Entry deletion saved"])
  assert.equal(reloads, 2)
})

test("authoring settings show a safe conflict message when persistence detects an external edit", async () => {
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({
      snippets: [],
      math_shortcuts: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda" }],
      hashes: { snippets: null, math_shortcuts: "math-hash" }
    }),
    writeRegistry: async () => {
      throw Object.assign(new Error("private filesystem detail"), { code: "conflict" })
    },
    reloadEditorRegistry: async () => {}
  })

  await dialog.open()
  document.querySelector('[data-authoring-tab="math_shortcuts"]').dispatchEvent(new Event("click"))
  document.querySelector(".authoring-entry-actions button:not(.authoring-delete)").dispatchEvent(new Event("click"))
  document.querySelector("#authoring-entry-form").dispatchEvent(new Event("submit", { cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 0))

  const message = document.querySelector("#authoring-settings-status").textContent
  assert.match(message, /settings changed outside Elef/)
  assert.doesNotMatch(message, /private filesystem detail/)
})
