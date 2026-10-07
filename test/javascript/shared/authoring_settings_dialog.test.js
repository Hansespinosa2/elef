import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseHTML } from "linkedom"
import { authoringSettingsElements, createAuthoringSettingsDialog } from "../../../app/javascript/lib/authoring_settings_dialog.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const sharedMarkup = await readFile(path.join(root, "app/views/shared/_authoring_settings_dialog.html.erb"), "utf8")

function installSelectValueSupport(document) {
  const select = document.querySelector("select")
  const prototype = Object.getPrototypeOf(select)
  if (Object.getOwnPropertyDescriptor(prototype, "value")?.set) return
  Object.defineProperty(prototype, "value", {
    configurable: true,
    get() {
      const selected = this.querySelector("option[selected]") || this.querySelector("option")
      return selected?.getAttribute("value") ?? selected?.textContent ?? ""
    },
    set(value) {
      for (const option of this.querySelectorAll("option")) {
        const optionValue = option.getAttribute("value") ?? option.textContent
        if (optionValue === String(value)) option.setAttribute("selected", "")
        else option.removeAttribute("selected")
      }
    }
  })
}

function createDialog({ readRegistries, writeRegistry, reloadEditorRegistry, renderMarkdownBlock = null, onSaved }) {
  const { document, Event } = parseHTML(`<!doctype html><html><body>${sharedMarkup}</body></html>`)
  installSelectValueSupport(document)
  const dialog = createAuthoringSettingsDialog({
    elements: authoringSettingsElements(document),
    readRegistries,
    writeRegistry,
    reloadEditorRegistry,
    renderMarkdownBlock,
    onSaved
  })
  return { dialog, document, Event }
}

test("the shared settings list exposes built-ins as read-only and filters the same entries by type and search", async () => {
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({
      snippets: [
        { id: "builtin", name: "Bold", trigger: "bold", category: "Markdown", body: "**${1:text}**", built_in: true },
        { id: "personal", name: "Note", trigger: "note", category: "Markdown", body: "# ${1:Note}", built_in: false }
      ],
      math_shortcuts: [],
      hashes: { snippets: "snippets-hash", math_shortcuts: null }
    }),
    writeRegistry: async () => ({ contentHash: null }),
    reloadEditorRegistry: async () => {}
  })

  await dialog.open()
  assert.equal(document.querySelector("#authoring-settings-count").textContent, "2 snippets · 1 personal")
  assert.equal(document.querySelectorAll(".snippet-card").length, 2)
  assert.equal(document.querySelector('[data-authoring-entry-id="builtin"]'), null)
  const builtin = [...document.querySelectorAll(".authoring-entry-card")].find(card => card.textContent.includes("Bold"))
  assert.equal(builtin.querySelector(".authoring-entry-actions"), null)

  const search = document.querySelector("#authoring-settings-search")
  search.value = "note"
  search.dispatchEvent(new Event("input"))
  assert.equal(document.querySelectorAll(".snippet-card").length, 1)
  assert.match(document.querySelector(".authoring-entry-card").textContent, /Note/)

  document.querySelector('[data-authoring-tab="math_shortcuts"]').dispatchEvent(new Event("click"))
  assert.equal(document.querySelector("#authoring-settings-title").textContent, "Math shortcuts")
  assert.equal(document.querySelector("#authoring-settings-category-field").hidden, true)
})

test("shared settings edit and delete through the injected transport while preserving the file hash handshake", async () => {
  const writes = []
  const saved = []
  let reloads = 0
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({
      snippets: [{ id: "default-bold", name: "Bold", trigger: "bold", category: "Markdown", body: "**${1:text}**", built_in: true },
        { id: "snippet-1", name: "Note", trigger: "note", category: "Markdown", body: "# Note", built_in: false }],
      math_shortcuts: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda", built_in: false }],
      hashes: { snippets: "snippets-hash", math_shortcuts: "math-hash" }
    }),
    writeRegistry: async payload => {
      writes.push(payload)
      return { contentHash: `hash-${writes.length}` }
    },
    reloadEditorRegistry: async () => { reloads += 1 },
    onSaved: message => saved.push(message)
  })

  await dialog.open({ registry: "math_shortcuts" })
  assert.equal(document.querySelector("#authoring-settings-count").textContent, "1 math shortcut · 1 personal")
  document.querySelector(".authoring-entry-actions button:not(.authoring-delete)").dispatchEvent(new Event("click"))
  document.querySelector('[name="aliases"]').value = "Lambda, l"
  document.querySelector("#authoring-entry-form").dispatchEvent(new Event("submit", { cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(writes[0].registry, "math_shortcuts")
  assert.equal(writes[0].baseHash, "math-hash")
  assert.equal(writes[0].entries.length, 1)
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

test("shared settings serialize rapid submits so one new entry creates only one record", async () => {
  const writes = []
  let finishWrite
  const pendingWrite = new Promise(resolve => { finishWrite = resolve })
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({ snippets: [], math_shortcuts: [], hashes: {} }),
    writeRegistry: async payload => {
      writes.push(payload)
      await pendingWrite
      return { entries: payload.entries.map(entry => ({ ...entry, id: 42 })) }
    },
    reloadEditorRegistry: async () => {}
  })

  await dialog.open({ registry: "snippets", openNew: true })
  document.querySelector('[name="name"]').value = "Rapid submit"
  document.querySelector('[name="trigger"]').value = "rapid-submit"
  document.querySelector('[name="category"]').value = "Markdown"
  document.querySelector('[name="body"]').value = "**${1:text}**"
  const form = document.querySelector("#authoring-entry-form")
  form.dispatchEvent(new Event("submit", { cancelable: true }))
  form.dispatchEvent(new Event("submit", { cancelable: true }))

  assert.equal(writes.length, 1)
  assert.equal(document.querySelector("#save-authoring-entry").disabled, true)
  finishWrite()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(document.querySelector("#save-authoring-entry").disabled, false)
  assert.equal(document.querySelectorAll(".authoring-entry-card").length, 1)
})

test("shared preview insertion sanitizes renderer output", async () => {
  const { dialog, document } = createDialog({
    readRegistries: async () => ({
      snippets: [{ id: "snippet-1", name: "Note", trigger: "note", category: "Markdown", body: "# ${1:Note}", built_in: false }],
      math_shortcuts: [],
      hashes: {}
    }),
    writeRegistry: async () => ({ contentHash: null }),
    reloadEditorRegistry: async () => {},
    renderMarkdownBlock: () => '<p class="preview">safe</p><script>unsafe()</script>'
  })

  await dialog.open()
  await new Promise(resolve => setTimeout(resolve, 0))
  const preview = document.querySelector(".snippet-example-preview")
  assert.equal(preview.textContent, "safe")
  assert.equal(preview.querySelector("script"), null)
})

test("shared settings show a safe conflict message when persistence detects an external edit", async () => {
  const { dialog, document, Event } = createDialog({
    readRegistries: async () => ({
      snippets: [],
      math_shortcuts: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda", built_in: false }],
      hashes: { snippets: null, math_shortcuts: "math-hash" }
    }),
    writeRegistry: async () => {
      throw Object.assign(new Error("private filesystem detail"), { code: "conflict" })
    },
    reloadEditorRegistry: async () => {}
  })

  await dialog.open({ registry: "math_shortcuts" })
  document.querySelector(".authoring-entry-actions button:not(.authoring-delete)").dispatchEvent(new Event("click"))
  document.querySelector("#authoring-entry-form").dispatchEvent(new Event("submit", { cancelable: true }))
  await new Promise(resolve => setTimeout(resolve, 0))

  const message = document.querySelector("#authoring-settings-status").textContent
  assert.match(message, /settings changed outside Elef/)
  assert.doesNotMatch(message, /private filesystem detail/)
})

test("shared settings keep the load failure visible after selecting the initial tab", async () => {
  const { dialog, document } = createDialog({
    readRegistries: async () => { throw new Error("private transport detail") },
    writeRegistry: async () => ({ contentHash: null }),
    reloadEditorRegistry: async () => {}
  })

  await dialog.open()

  assert.match(document.querySelector("#authoring-settings-status").textContent, /Could not load authoring settings/)
  assert.doesNotMatch(document.querySelector("#authoring-settings-status").textContent, /private transport detail/)
})
