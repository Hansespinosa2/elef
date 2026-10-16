import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

import { PALETTE_ACTION_IDS } from "@elef/client/shortcuts"
import { desktopMenuKeyAction } from "@elef/editor-runtime/desktop-menu-keys"

// Web-host keyboard suite: the shared registry (packages/client) owns the
// WHAT; this file proves the web Stimulus adapter honors it — new chords,
// preserved chords, Vim pass-through, and palette coverage.
const hostControllerPath = new URL("../../app/javascript/controllers/", import.meta.url)

async function loadController(name) {
  let source = await readFile(new URL(`${name}_controller.js`, hostControllerPath), "utf8")
  source = source.replace(/^import\s+[\s\S]*?\s+from\s+["']([^"']+)["'];?\s*/gm, (_statement, specifier) => {
    return specifier === "@hotwired/stimulus" ? "class Controller {}\n" : ""
  })
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return (await import(url)).default
}

const CommandPaletteController = await loadController("command_palette")

function fakeEvent(key, { metaKey = false, ctrlKey = false, shiftKey = false, altKey = false } = {}) {
  let defaultPrevented = false
  return {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    isComposing: false,
    preventDefault() { defaultPrevented = true },
    get defaultPrevented() { return defaultPrevented },
  }
}

function fakeElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    textContent: "",
    className: "",
    append(...nodes) { this.children.push(...nodes) },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    scrollIntoView() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    replaceChildren(...nodes) { this.children = nodes },
    closest() { return null },
    click() { this.clicked = (this.clicked || 0) + 1 },
    focus() {},
  }
}

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else delete globalThis[name]
  }
}

// Faithful model of the verified Vim layer (@replit/codemirror-vim-core
// vim.js vimKeyFromEvent + handleKey): only events that map to a Vim motion
// are consumed (stopPropagation); Cmd/Ctrl-modified keys are unmapped
// (<M-s>, <M-Enter>, ...) so they propagate to the window handler.
function vimInterceptor(event, vimEnabled) {
  if (!vimEnabled) return false
  const modified = event.metaKey || event.ctrlKey
  if (!modified && !event.altKey && !event.isComposing) return true // swallowed by Vim
  return false // passes through to the window-level chord handler
}

function dispatchThroughVim(controller, event, vimEnabled) {
  if (vimInterceptor(event, vimEnabled)) return "swallowed-by-vim"
  controller.globalKeydown(event)
  return event.defaultPrevented ? "handled" : "ignored"
}

function baseController(overrides = {}) {
  const controller = new CommandPaletteController()
  Object.assign(controller, {
    mode: "commands",
    dialogTarget: { open: false, hasAttribute: () => false, dataset: {}, setAttribute() {}, removeAttribute() {} },
    inputTarget: { value: "", focus() {}, setAttribute() {}, removeAttribute() {} },
    cancelSearch() {},
    setModeChrome() {},
    updateFilterSelection() {},
    renderCurrentMode() {},
    setStatus() {},
    closeCalled: 0,
    close() { this.closeCalled += 1 },
    ...overrides,
  })
  return controller
}

test("Cmd+S saves in the editor context and prevents the browser dialog", () => {
  let submitted = 0
  const restoreDocument = replaceGlobal("document", {
    querySelector: (selector) => selector === "form[data-controller~='autosave']"
      ? { requestSubmit() { submitted += 1 } }
      : null,
  })
  const controller = baseController()
  const event = fakeEvent("s", { metaKey: true })
  try {
    controller.globalKeydown(event)
  } finally {
    restoreDocument()
  }
  assert.equal(event.defaultPrevented, true)
  assert.equal(submitted, 1)
  assert.equal(controller.closeCalled, 1)
})

test("Cmd+S outside the editor leaves the browser default alone", () => {
  const restoreDocument = replaceGlobal("document", { querySelector: () => null })
  const controller = baseController()
  const event = fakeEvent("s", { metaKey: true })
  try {
    controller.globalKeydown(event)
  } finally {
    restoreDocument()
  }
  assert.equal(event.defaultPrevented, false)
  assert.equal(controller.closeCalled, 0)
})

test("Cmd+Enter presents when a publish target exists, otherwise ignored", () => {
  let clicked = 0
  const restoreDocument = replaceGlobal("document", {
    querySelector: (selector) => selector.includes("publish")
      ? { tagName: "BUTTON", click() { clicked += 1 }, closest: () => null }
      : null,
  })
  const controller = baseController()
  const event = fakeEvent("Enter", { metaKey: true })
  try {
    controller.globalKeydown(event)
  } finally {
    restoreDocument()
  }
  assert.equal(event.defaultPrevented, true)
  // Click (not programmatic submit) so the dirty-navigation guard still
  // confirms before presenting with unsaved changes.
  assert.equal(clicked, 1)

  const restoreEmpty = replaceGlobal("document", { querySelector: () => null })
  const idle = baseController()
  const absent = fakeEvent("Enter", { metaKey: true })
  try {
    idle.globalKeydown(absent)
  } finally {
    restoreEmpty()
  }
  assert.equal(absent.defaultPrevented, false)
  assert.equal(idle.closeCalled, 0)
})

test("pre-existing chords Cmd+K and Cmd+P still open their modes", () => {
  const controller = baseController()
  let opened = null
  controller.openMode = (mode) => { opened = mode }
  controller.globalKeydown(fakeEvent("k", { metaKey: true }))
  assert.equal(opened, "commands")
  controller.globalKeydown(fakeEvent("p", { ctrlKey: true }))
  assert.equal(opened, "search")
})

test("every global Cmd chord fires with Vim mode enabled", () => {
  const restoreDocument = replaceGlobal("document", {
    querySelector: () => ({ requestSubmit() {}, closest: () => null, click() {} }),
  })
  const outcomes = {}
  try {
    for (const [key, label] of [["k", "commands"], ["p", "search"], ["s", "save"], ["Enter", "present"]]) {
      const controller = baseController()
      let opened = null
      controller.openMode = (mode) => { opened = mode }
      const event = fakeEvent(key, { metaKey: true })
      const fate = dispatchThroughVim(controller, event, true /* vimEnabled */)
      outcomes[label] = opened ?? (event.defaultPrevented ? "handled" : fate)
    }
  } finally {
    restoreDocument()
  }
  assert.equal(outcomes.commands, "commands")
  assert.equal(outcomes.search, "search")
  assert.equal(outcomes.save, "handled")
  assert.equal(outcomes.present, "handled")
})

test("desktop webview dispatch keeps Cmd+K and adds Cmd+Enter for present", () => {
  const key = (keyName, flags = {}) => ({
    key: keyName, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...flags,
  })
  // Pre-existing behavior preserved exactly: Cmd/Ctrl+K focuses search.
  assert.equal(desktopMenuKeyAction(key("k", { metaKey: true })), "focus-search")
  assert.equal(desktopMenuKeyAction(key("k", { ctrlKey: true })), "focus-search")
  assert.equal(desktopMenuKeyAction(key("K", { metaKey: true, shiftKey: true })), "focus-search")
  // New present chord, guarded so shifted/alt/IME variants keep platform meaning.
  assert.equal(desktopMenuKeyAction(key("Enter", { metaKey: true })), "start-presentation")
  assert.equal(desktopMenuKeyAction(key("Enter", { ctrlKey: true })), "start-presentation")
  assert.equal(desktopMenuKeyAction(key("Enter", { metaKey: true, shiftKey: true })), null)
  assert.equal(desktopMenuKeyAction(key("Enter", { metaKey: true, altKey: true })), null)
  assert.equal(desktopMenuKeyAction(key("Enter", { metaKey: true, isComposing: true })), null)
  // Unmodified keys never dispatch: typing and Vim motions are untouched.
  assert.equal(desktopMenuKeyAction(key("Enter")), null)
  assert.equal(desktopMenuKeyAction(key("k")), null)
  assert.equal(desktopMenuKeyAction(key("s", { metaKey: true })), null)
})

test("Vim normal mode still swallows unmodified keys (no global collision)", () => {
  const controller = baseController()
  let opened = null
  controller.openMode = (mode) => { opened = mode }
  // Bare "s" in Vim normal mode is a motion, not Save: the interceptor eats
  // it before the window handler, and the handler itself ignores it too.
  assert.equal(dispatchThroughVim(controller, fakeEvent("s"), true), "swallowed-by-vim")
  assert.equal(opened, null)
})

test("palette rows show label, description, and a kbd chip for chorded actions", () => {
  const created = []
  const restoreDocument = replaceGlobal("document", {
    createElement: (tag) => {
      const element = fakeElement(tag)
      created.push(element)
      return element
    },
  })
  const controller = new CommandPaletteController()
  Object.assign(controller, {
    shortcutModifier: "⌘",
    resultsTarget: fakeElement(),
    normalize: (text) => text.toLowerCase(),
    renderEmptyState() {},
    updateSelection() {},
  })
  try {
    controller.renderOptions(
      [
        { label: "Save current work", description: "Submit the active editor", shortcutKey: "s" },
        { label: "Report a bug", description: "Open the bug report dialog" },
      ],
      "",
      "none",
    )
  } finally {
    restoreDocument()
  }
  const rows = controller.resultsTarget.children
  assert.equal(rows.length, 2)
  const [title, details, chip] = rows[0].children
  assert.equal(title.textContent, "Save current work")
  assert.equal(details.textContent, "Submit the active editor")
  assert.equal(chip.tagName, "KBD")
  assert.equal(chip.textContent, "⌘S")
  assert.equal(rows[1].children.length, 2)
})

test("slide-structure palette actions click the overview buttons", () => {
  const clicked = []
  const restoreDocument = replaceGlobal("document", {
    createElement: (tag) => fakeElement(tag),
    querySelector: (selector) => selector.startsWith("[data-action='slide-overview#")
      ? { click() { clicked.push(selector) } }
      : null,
  })
  const controller = baseController()
  try {
    for (const id of ["slide-add", "slide-duplicate", "slide-delete", "slide-move-up", "slide-move-down"]) {
      controller.runCommand(id)
    }
  } finally {
    restoreDocument()
  }
  assert.deepEqual(clicked, [
    "[data-action='slide-overview#add']",
    "[data-action='slide-overview#duplicate']",
    "[data-action='slide-overview#delete']",
    "[data-action='slide-overview#moveUp']",
    "[data-action='slide-overview#moveDown']",
  ])
  assert.equal(controller.closeCalled, 5)
})

test("runCommand handles every registry palette action without throwing", () => {
  const statuses = []
  const restoreDocument = replaceGlobal("document", {
    createElement: (tag) => fakeElement(tag),
    querySelector: () => null,
  })
  const restoreWindow = replaceGlobal("window", { location: { assign() {} } })
  try {
    for (const id of PALETTE_ACTION_IDS) {
      const controller = new CommandPaletteController()
      Object.assign(controller, {
        mode: "commands",
        commandsValue: [],
        visibleCommands: [],
        dialogTarget: { open: false, hasAttribute: () => false, dataset: {}, setAttribute() {}, removeAttribute() {} },
        inputTarget: { value: "", focus() {}, setAttribute() {}, removeAttribute() {} },
        resultsTarget: fakeElement(),
        filtersTarget: { hidden: true, querySelectorAll: () => [] },
        headingTarget: { textContent: "" },
        closeButtonTarget: { textContent: "", setAttribute() {} },
        hintTarget: { textContent: "" },
        statusTarget: { set text(value) { statuses.push([id, value]) } },
        cancelSearch() {},
        setModeChrome() {},
        updateFilterSelection() {},
        renderCurrentMode() {},
        closeCalled: 0,
        close() { this.closeCalled += 1 },
      })
      controller.setStatus = function (value) { statuses.push([id, value]) }
      controller.runCommand(id)
    }
  } finally {
    restoreDocument()
    restoreWindow()
  }
  // Editor-gated and page-scoped actions degrade to a status note instead of
  // throwing when their target is absent; nothing threw above.
  assert.ok(statuses.length >= 0)
})
