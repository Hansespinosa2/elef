import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

async function loadController(name) {
  const source = (await readFile(new URL(`../../app/javascript/controllers/${name}_controller.js`, import.meta.url), "utf8"))
    .replace('import { Controller } from "@hotwired/stimulus"', "class Controller {}")
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default
}

function installGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous)
    else delete globalThis[name]
  }
}

const DirtyController = await loadController("dirty")
const AutofocusController = await loadController("autofocus")
const PrintViewController = await loadController("print_view")

test("dirty state keeps newer edits dirty when an older save completes", () => {
  const fields = [{ value: "Deck" }, { value: "# Original" }]
  const statusTarget = { textContent: "" }
  const saveButtonTarget = { disabled: true }
  const windowListeners = new Map()
  const documentListeners = new Map()
  const restoreWindow = installGlobal("window", {
    addEventListener(type, listener) { windowListeners.set(type, listener) },
    removeEventListener(type, listener) { windowListeners.delete(type) },
    confirm() { return false }
  })
  const restoreDocument = installGlobal("document", {
    addEventListener(type, listener) { documentListeners.set(type, listener) },
    removeEventListener(type, listener) { documentListeners.delete(type) }
  })

  const controller = new DirtyController()
  Object.assign(controller, {
    fieldTargets: fields,
    hasStatusTarget: true,
    statusTarget,
    hasSaveButtonTarget: true,
    saveButtonTarget,
    unsavedMessageValue: "Discard unsaved changes?"
  })

  try {
    controller.connect()
    assert.equal(statusTarget.textContent, "Saved")
    assert.equal(saveButtonTarget.disabled, false)

    fields[1].value = "# First edit"
    controller.markDirty()
    controller.markSaving()
    fields[1].value = "# Newer edit"
    controller.markDirty()

    controller.markSaved({ detail: { snapshot: "Deck\u001f# First edit" } })
    assert.equal(controller.dirty, true)
    assert.equal(statusTarget.textContent, "Unsaved changes")

    controller.markSaved({ detail: { snapshot: controller.snapshot() } })
    assert.equal(controller.dirty, false)
    assert.equal(statusTarget.textContent, "Saved")
    assert.equal(windowListeners.has("beforeunload"), true)
  } finally {
    controller.disconnect()
    restoreDocument()
    restoreWindow()
  }
  assert.equal(windowListeners.size, 0)
  assert.equal(documentListeners.size, 0)
})

test("dirty navigation blocks a cancelled same-tab link but allows new tabs and downloads", () => {
  let confirmations = 0
  const restoreWindow = installGlobal("window", {
    confirm(message) {
      confirmations += 1
      assert.equal(message, "Discard unsaved changes?")
      return false
    }
  })
  const controller = new DirtyController()
  Object.assign(controller, { dirty: true, submitting: false, unsavedMessageValue: "Discard unsaved changes?" })
  const linkEvent = link => ({
    target: { closest: selector => selector === "a[href]" ? link : null },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true },
    stopImmediatePropagation() { this.stopped = true }
  })

  try {
    const sameTab = linkEvent({ target: "_self", hasAttribute: () => false })
    controller.guardNavigation(sameTab)
    assert.equal(sameTab.prevented, true)
    assert.equal(sameTab.stopped, true)

    const newTab = linkEvent({ target: "_blank", hasAttribute: () => false })
    controller.guardNavigation(newTab)
    assert.equal(newTab.prevented, false)

    const download = linkEvent({ target: "_self", hasAttribute: name => name === "download" })
    controller.guardNavigation(download)
    assert.equal(download.prevented, false)
    assert.equal(confirmations, 1)
  } finally {
    restoreWindow()
  }
})

test("autofocus prevents a focus request from scrolling the page", () => {
  const calls = []
  const controller = new AutofocusController()
  controller.element = { focus(options) { calls.push(options) } }

  controller.connect()

  assert.deepEqual(calls, [{ preventScroll: true }])
})

test("print cleanup pauses videos, resets playback, and still calls the browser print action", () => {
  let printed = 0
  const firstVideo = { currentTime: 12, pauseCalls: 0, pause() { this.pauseCalls += 1 } }
  const unsafeVideo = {
    pauseCalls: 0,
    pause() { this.pauseCalls += 1 },
    get currentTime() { return 4 },
    set currentTime(_value) { throw new Error("media source cannot seek") }
  }
  const restoreWindow = installGlobal("window", { print() { printed += 1 } })
  const controller = new PrintViewController()
  controller.element = { querySelectorAll: selector => selector === "video" ? [firstVideo, unsafeVideo] : [] }

  try {
    controller.print()
  } finally {
    restoreWindow()
  }

  assert.equal(firstVideo.pauseCalls, 1)
  assert.equal(firstVideo.currentTime, 0)
  assert.equal(unsafeVideo.pauseCalls, 1)
  assert.equal(printed, 1)
})
