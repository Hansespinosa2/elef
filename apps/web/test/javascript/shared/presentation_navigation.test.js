import test from "node:test"
import assert from "node:assert/strict"
import { createPresentationNavigation, presentationActionForKey } from "../../../../../packages/client/src/features/presentation/navigation.js"

test("presentation hosts share the same next, previous, home, and end keys", () => {
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]) {
    assert.equal(presentationActionForKey(key), "next", `${key} advances`)
  }
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) {
    assert.equal(presentationActionForKey(key), "previous", `${key} goes back`)
  }
  assert.equal(presentationActionForKey("Home"), "first")
  assert.equal(presentationActionForKey("End"), "last")
  assert.equal(presentationActionForKey("Escape"), null)
})

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

test("presentation navigation can restore its current index after a preview refresh", () => {
  assert.equal(createPresentationNavigation(3, 1).currentIndex, 1)
  assert.equal(createPresentationNavigation(3, 8).currentIndex, 2)
  assert.equal(createPresentationNavigation(3, -2).currentIndex, 0)
  assert.equal(createPresentationNavigation(3, 1.5).currentIndex, 0)
})

test("presentation navigation refuses empty or invalid slide counts", () => {
  assert.equal(createPresentationNavigation(0), null)
  assert.equal(createPresentationNavigation(1.5), null)
  assert.equal(createPresentationNavigation("2"), null)
})
