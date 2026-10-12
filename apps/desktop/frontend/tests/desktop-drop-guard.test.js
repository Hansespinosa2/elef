import assert from "node:assert/strict"
import test from "node:test"

import { installDesktopDropGuard, isEditorSurfaceDropTarget } from "../src/desktop-drop-guard.js"

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

function dropOn(target) {
  let prevented = false
  const handler = target.window.listeners.get("drop").handler
  handler({ target: target.node, preventDefault: () => { prevented = true } })
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

test("drops outside the editor are swallowed so the webview never navigates to a file URL", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(window.listeners.get("drop").capture, true)
  assert.equal(dropOn({ window, node: fakeTarget({ insideEditor: false }) }), true)
})

test("drops on the editor surfaces pass through to the shared media controller", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(dropOn({ window, node: fakeTarget({ insideEditor: true }) }), false)
})

test("targets without ancestor queries are swallowed instead of throwing", () => {
  const window = fakeWindow()
  installDesktopDropGuard(window)
  assert.equal(dropOn({ window, node: {} }), true)
  assert.equal(dropOn({ window, node: null }), true)
})

test("uninstalling removes the capture listener", () => {
  const window = fakeWindow()
  const uninstall = installDesktopDropGuard(window)
  assert.equal(window.listeners.has("drop"), true)
  uninstall()
  assert.equal(window.listeners.has("drop"), false)
})
