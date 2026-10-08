import test from "node:test"
import assert from "node:assert/strict"
import { fixedArtContainment, offsetWithin, sequenceHorizontalEligible } from "../../app/javascript/lib/art_layout.js"

test("ART-LAY-006: sequence horizontal eligibility uses the exact computed-width formula", () => {
  const minimum = 200
  const gap = 16
  const itemCount = 4
  const threshold = minimum * itemCount + gap * (itemCount - 1)
  const eligible = width => sequenceHorizontalEligible({
    width,
    itemCount,
    density: "compact",
    gap,
    sequenceMinInline: minimum
  })

  assert.equal(eligible(threshold - 2), false)
  assert.equal(eligible(threshold), true)
  assert.equal(eligible(threshold + 2), true)
  assert.equal(eligible(1120), true)
  assert.equal(sequenceHorizontalEligible({ width: 1120, itemCount: 6, density: "compact", gap, sequenceMinInline: minimum }), false)
  assert.equal(sequenceHorizontalEligible({ width: 1120, itemCount: 4, density: "rich", gap, sequenceMinInline: minimum }), false)
  assert.equal(sequenceHorizontalEligible({ width: 1120, itemCount: 1, density: "compact", gap, sequenceMinInline: minimum }), false)
})

test("ART-TEST-006: compact Sequence horizontal eligibility is monotonic as host width increases", () => {
  for (const itemCount of [2, 3, 4, 5, 6, 8, 12]) {
    let eligibleBefore = false
    for (let width = 0; width <= 1400; width += 1) {
      const eligible = sequenceHorizontalEligible({
        width,
        itemCount,
        density: "compact",
        gap: 16,
        sequenceMinInline: 200
      })
      assert.equal(eligibleBefore && !eligible, false, `${itemCount} items became ineligible again at ${width}px`)
      eligibleBefore ||= eligible
    }
  }
})

test("ART-FIT-OFFSET: offsetWithin sums layout offsets only through the positioned host", () => {
  const host = {}
  const parent = { offsetLeft: 7, offsetTop: 9, offsetParent: host }
  const root = { offsetLeft: 13, offsetTop: 15, offsetParent: parent }
  assert.deepEqual(offsetWithin(root, host), { left: 20, top: 24 })
  assert.equal(offsetWithin(root, {}), null)
})

test("ART-FIT-ORACLE: the fixed containment oracle checks host, root, item, and host-relative bounds", () => {
  const host = { clientWidth: 320, clientHeight: 240, scrollWidth: 320, scrollHeight: 240 }
  const item = { tagName: "LI", clientWidth: 200, clientHeight: 40, scrollWidth: 200, scrollHeight: 40 }
  const list = { children: [item] }
  const root = {
    clientWidth: 300,
    clientHeight: 100,
    scrollWidth: 300,
    scrollHeight: 100,
    offsetParent: host,
    offsetLeft: 10,
    offsetTop: 20,
    offsetWidth: 300,
    offsetHeight: 100,
    querySelector: selector => selector === ".elef-art-list" ? list : null
  }

  assert.equal(fixedArtContainment(root, host).fits, true)
  host.scrollHeight = 241
  assert.equal(fixedArtContainment(root, host).fits, true)
  host.scrollHeight = 242
  assert.equal(fixedArtContainment(root, host).fits, false)
  host.scrollHeight = 240
  item.scrollHeight = 42
  assert.equal(fixedArtContainment(root, host).fits, false)
  item.scrollHeight = 40
  root.offsetLeft = 22
  assert.equal(fixedArtContainment(root, host).fits, false)
})
