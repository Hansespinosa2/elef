import assert from "node:assert/strict"
import test from "node:test"

import { installDesktopDropGuard, isEditorSurfaceDropTarget, isFileDrag } from "../src/desktop-drop-guard.js"

function fakeWindow() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, handler, capture) {
      listeners.set(type, { handler, capture })
    },
    removeEventListener(type, handler, capture) {
      const current = listeners.get(type)
      if (current?.handler === handler && current?.capture === capture) listeners.delete(type)
    }
  }
}

function fakeTarget({ insideEditor }) {
  // The guard asks one ancestor query against the shared surfaces.
  return { closest: () => (insideEditor ? {} : null) }
}

function fileDrag(node) {
  return { target: node, dataTransfer: { types: ["Files"] }, preventDefault: () => {} }
}

function textDrag(node) {
  return { target: node, dataTransfer: { types: ["text/plain"] }, preventDefault: () => {} }
}

function dispatch(window, type, event) {
  let prevented = false
  const entry = window.listeners.get(type)
  assert.ok(entry, `expected a ${type} listener`)
  entry.handler({ ...event, preventDefault: () => { prevented = true } })
  return prevented
}

test("the guard recognizes the shared editor drop surfaces", () => {
  let seen = ""
  const target = {
    closest: selectors => {
      seen = selectors
      return {}
    }
  }
  assert.equal(isEditorSurfaceDropTarget(target), true)
  assert.match(seen, /\.editor-surface/)
  assert.match(seen, /\.editor-projection/)
  assert.equal(isEditorSurfaceDropTarget({ closest: () => null }), false)
  assert.equal(isEditorSurfaceDropTarget(null), false)
})

test("only drags carrying files count as file drags", () => {
  assert.equal(isFileDrag(fileDrag({})), true)
  assert.equal(isFileDrag(textDrag({})), false)
  assert.equal(isFileDrag({}), false)
  assert.equal(isFileDrag(null), false)
})

test("file dragover outside the editor is cancelled so the drop guard can fire", () => {
  // A drop event only dispatches where dragover was cancelled; without this
  // the webview would navigate to the file:// URL on a misdrop.
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(window.listeners.get("dragover").capture, true)
  assert.equal(dispatch(window, "dragover", fileDrag(fakeTarget({ insideEditor: false }))), true)
})

test("file drops outside the editor are swallowed so the webview never navigates to a file URL", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(window.listeners.get("drop").capture, true)
  assert.equal(dispatch(window, "drop", fileDrag(fakeTarget({ insideEditor: false }))), true)
})

test("text drags outside the editor pass through so drops into inputs keep working", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  const node = fakeTarget({ insideEditor: false })
  assert.equal(dispatch(window, "dragover", textDrag(node)), false)
  assert.equal(dispatch(window, "drop", textDrag(node)), false)
})

test("drags on the editor surfaces pass through to the shared media controller", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  const node = fakeTarget({ insideEditor: true })
  assert.equal(dispatch(window, "dragover", fileDrag(node)), false)
  assert.equal(dispatch(window, "drop", fileDrag(node)), false)
})

test("targets without ancestor queries are swallowed instead of throwing", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(dispatch(window, "drop", fileDrag({})), true)
  assert.equal(dispatch(window, "drop", { target: null, dataTransfer: { types: ["Files"] } }), true)
})

test("events without a drag payload pass through instead of throwing", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(dispatch(window, "dragover", { target: fakeTarget({ insideEditor: false }) }), false)
  assert.equal(dispatch(window, "drop", { target: fakeTarget({ insideEditor: false }) }), false)
})

test("uninstalling removes both capture listeners", () => {
  const window = fakeWindow()
  const uninstall = installDesktopDropGuard(window)
  assert.equal(window.listeners.has("dragover"), true)
  assert.equal(window.listeners.has("drop"), true)
  uninstall()
  assert.equal(window.listeners.has("dragover"), false)
  assert.equal(window.listeners.has("drop"), false)
})
