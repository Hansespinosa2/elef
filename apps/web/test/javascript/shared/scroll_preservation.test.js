import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseHTML } from "linkedom"

import { loadPackageSource } from "./package_source.mjs"

const source = await loadPackageSource("packages/editor-runtime/src/lib/scroll_preservation.ts")
const { preserveSurfaceScroll } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

function layout(element, { scrollHeight = 0, clientHeight = 0, scrollTop = 0, rect = null } = {}) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true })
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true })
  Object.defineProperty(element, "scrollWidth", { value: 100, configurable: true })
  Object.defineProperty(element, "clientWidth", { value: 100, configurable: true })
  element.scrollTop = scrollTop
  if (rect) element.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) })
  return element
}

function harness() {
  const { document } = parseHTML(`
    <div id="outer"><div id="surface">
      <div data-editor-block-id="b1">one</div>
      <div data-editor-block-id="b2">two</div>
    </div></div>
  `)
  const outer = document.querySelector("#outer")
  const surface = document.querySelector("#surface")
  const [b1, b2] = [...surface.querySelectorAll("[data-editor-block-id]")]
  layout(outer, { scrollHeight: 2000, clientHeight: 500, scrollTop: 931, rect: { top: 0, bottom: 500 } })
  layout(surface, { scrollHeight: 2000, clientHeight: 500, scrollTop: 120, rect: { top: 0, bottom: 500 } })
  layout(b1, { rect: { top: -400, bottom: -50 } })
  layout(b2, { rect: { top: -50, bottom: 300 } })
  return { document, outer, surface }
}

test("a rebuild that keeps the anchor block restores every scroller", () => {
  const { outer, surface } = harness()
  const preserved = preserveSurfaceScroll(surface)

  // The rebuild collapses scroll height and clamps tops to zero.
  outer.scrollTop = 0
  surface.scrollTop = 0
  surface.replaceChildren()
  const rebuilt = surface.ownerDocument.createElement("div")
  rebuilt.setAttribute("data-editor-block-id", "b2")
  rebuilt.textContent = "two"
  surface.appendChild(rebuilt)

  preserved.restore()
  assert.equal(outer.scrollTop, 931)
  assert.equal(surface.scrollTop, 120)
})

test("a rebuild without the anchor block keeps its natural top", () => {
  const { outer, surface, document } = harness()
  const preserved = preserveSurfaceScroll(surface)

  surface.replaceChildren()
  const rebuilt = document.createElement("div")
  rebuilt.setAttribute("data-editor-block-id", "b9")
  rebuilt.textContent = "other work"
  surface.appendChild(rebuilt)
  outer.scrollTop = 0

  preserved.restore()
  assert.equal(outer.scrollTop, 0)
})

test("a replacement surface restores the old scroll chain only for the same anchor", () => {
  const { outer, surface, document } = harness()
  const preserved = preserveSurfaceScroll(surface)
  const replacement = layout(document.createElement("div"), { scrollHeight: 2000, clientHeight: 500 })
  replacement.innerHTML = '<div data-editor-block-id="b2">two</div>'
  surface.replaceWith(replacement)
  outer.scrollTop = 0
  preserved.restore(replacement)
  assert.equal(outer.scrollTop, 931)
  assert.equal(replacement.scrollTop, 120)

  replacement.innerHTML = '<div data-editor-block-id="different">other work</div>'
  outer.scrollTop = 0
  replacement.scrollTop = 0
  preserved.restore(replacement)
  assert.equal(outer.scrollTop, 0)
  assert.equal(replacement.scrollTop, 0)
})

test("window scroll restores through the same gate", async () => {
  const { surface } = harness()
  const calls = []
  const fakeWindow = { scrollY: 120, scrollX: 0, scrollTo: (x, y) => calls.push([x, y]) }
  const realWindow = globalThis.window
  globalThis.window = fakeWindow
  try {
    const preserved = preserveSurfaceScroll(surface)
    fakeWindow.scrollY = 0
    preserved.restore()
    assert.deepEqual(calls, [[0, 120]])
  } finally {
    if (realWindow === undefined) delete globalThis.window
    else globalThis.window = realWindow
  }
})

test("paginate captures before the rebuild and restores after", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
  const controller = await readFile(
    path.join(root, "packages/editor-runtime/src/controllers/document_pages_controller.ts"), "utf8"
  )
  const captureAt = controller.indexOf("preserveSurfaceScroll(this.surfaceTarget)")
  const wipeAt = controller.indexOf("this.surfaceTarget.replaceChildren()")
  const restoreAt = controller.indexOf("preservedScroll.restore()")
  const takeRecordsAt = controller.indexOf("this.mutationObserver?.takeRecords()", wipeAt)
  const frameAt = controller.indexOf("requestAnimationFrame", wipeAt)
  assert.ok(captureAt >= 0 && wipeAt > captureAt, "scroll is captured before the surface is wiped")
  assert.ok(restoreAt > wipeAt, "scroll is restored after the rebuild")
  assert.ok(
    restoreAt < takeRecordsAt && takeRecordsAt < frameAt,
    "restore stays synchronous in the paginate task, ahead of the finalize frame"
  )
  assert.ok(
    !controller.slice(captureAt, restoreAt).includes("await "),
    "no await may slip between capture and restore"
  )
})
