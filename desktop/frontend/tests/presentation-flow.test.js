import test from "node:test"
import assert from "node:assert/strict"
import { createPresentationNavigation } from "../src/presentation-flow.js"

test("presentation navigation clamps at each end and supports home/end", () => {
  const navigation = createPresentationNavigation(3)
  assert.ok(navigation)
  assert.equal(navigation.currentIndex, 0)
  assert.equal(navigation.previous(), 0)
  assert.equal(navigation.next(), 1)
  assert.equal(navigation.next(), 2)
  assert.equal(navigation.next(), 2)
  assert.equal(navigation.first(), 0)
  assert.equal(navigation.last(), 2)
})

test("presentation navigation refuses empty or invalid slide counts", () => {
  assert.equal(createPresentationNavigation(0), null)
  assert.equal(createPresentationNavigation(1.5), null)
  assert.equal(createPresentationNavigation("2"), null)
})
