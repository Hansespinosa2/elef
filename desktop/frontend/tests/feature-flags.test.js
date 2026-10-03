import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import {
  applyDesktopFeatureFlags,
  desktopFeatureEnabled,
  DESKTOP_FEATURE_FLAGS
} from "../src/feature-flags.js"

test("revision and lineage features default off for desktop", () => {
  assert.deepEqual(DESKTOP_FEATURE_FLAGS, {
    ELEF_ENABLE_REVISIONS: false,
    ELEF_ENABLE_LINEAGE: false
  })
  assert.equal(desktopFeatureEnabled("ELEF_ENABLE_REVISIONS"), false)
  assert.equal(desktopFeatureEnabled("ELEF_ENABLE_LINEAGE"), false)
})

test("feature-marked controls fail closed and an enabled flag reveals its control", () => {
  const { document } = parseHTML(`
    <html><body>
      <button data-desktop-feature="revisions">History</button>
      <a data-desktop-feature="lineage">Lineage</a>
    </body></html>
  `)

  applyDesktopFeatureFlags(document)
  const revisions = document.querySelector('[data-desktop-feature="revisions"]')
  const lineage = document.querySelector('[data-desktop-feature="lineage"]')
  assert.equal(revisions.hidden, true)
  assert.equal(revisions.disabled, true)
  assert.equal(revisions.getAttribute("aria-hidden"), "true")
  assert.equal(lineage.hidden, true)

  applyDesktopFeatureFlags(document, { ...DESKTOP_FEATURE_FLAGS, ELEF_ENABLE_REVISIONS: true })
  assert.equal(revisions.hidden, false)
  assert.equal(revisions.disabled, false)
  assert.equal(revisions.getAttribute("aria-hidden"), "false")
  assert.equal(lineage.hidden, true)
})

test("unknown or malformed feature controls remain unavailable", () => {
  const { document } = parseHTML('<html><body><button data-desktop-feature="history">History</button></body></html>')
  applyDesktopFeatureFlags(document, { ELEF_ENABLE_REVISIONS: "true" })
  assert.equal(document.querySelector("button").hidden, true)
  assert.equal(document.querySelector("button").disabled, true)
})
