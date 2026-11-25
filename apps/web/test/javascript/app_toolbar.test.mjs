import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { loadPackageSource } from "./shared/package_source.mjs"

const source = await loadPackageSource("packages/client/src/application/app_toolbar.ts")
const { setupAppToolbar } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("toolbar visibility survives navigation and can be restored", () => {
  const values = new Map()
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const first = parseHTML('<input id="app-toolbar-visible" type="checkbox" checked>').document
  const toggle = first.querySelector("input")
  setupAppToolbar(first)
  assert.equal(toggle.checked, true)
  toggle.checked = false
  toggle.dispatchEvent(new first.defaultView.Event("change"))
  const next = parseHTML('<input id="app-toolbar-visible" type="checkbox" checked>').document
  setupAppToolbar(next)
  assert.equal(next.querySelector("input").checked, false)
  next.querySelector("input").checked = true
  next.querySelector("input").dispatchEvent(new next.defaultView.Event("change"))
  assert.equal(values.get("elef.toolbar.visible"), "true")
  delete globalThis.sessionStorage
})

test("toolbar remains usable when storage is unavailable", () => {
  globalThis.sessionStorage = { getItem() { throw Error("unavailable") }, setItem() { throw Error("unavailable") } }
  const doc = parseHTML('<input id="app-toolbar-visible" type="checkbox" checked>').document
  const toggle = doc.querySelector("input")
  toggle.checked = true
  setupAppToolbar(doc)
  assert.equal(toggle.checked, true)
  toggle.checked = false
  assert.doesNotThrow(() => toggle.dispatchEvent(new doc.defaultView.Event("change")))
  delete globalThis.sessionStorage
})
