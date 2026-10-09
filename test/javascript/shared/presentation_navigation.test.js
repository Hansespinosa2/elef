import test from "node:test"
import assert from "node:assert/strict"
import { createPresentationNavigation, presentationActionForKey } from "../../../app/javascript/lib/presentation_navigation.js"

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

test("each next and previous advances one cumulative event before changing slides", () => {
  const navigation = createPresentationNavigation(3, 0, [2, 0, 1])

  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 0])
  navigation.next()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 1])
  navigation.next()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 2])
  navigation.next()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [1, 0])
  navigation.next()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [2, 0])
  navigation.previous()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [1, 0])
  navigation.previous()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 2])
  navigation.previous()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 1])
  navigation.previous()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 0])
  navigation.previous()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 0])
})

test("home and end select the first closed and final fully revealed states", () => {
  const navigation = createPresentationNavigation(2, 0, [3, 2])
  navigation.last()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [1, 2])
  navigation.first()
  assert.deepEqual([navigation.currentIndex, navigation.revealedEventCount], [0, 0])
})

test("presentation navigation can restore its current index after a preview refresh", () => {
  assert.equal(createPresentationNavigation(3, 1).currentIndex, 1)
  assert.equal(createPresentationNavigation(3, 8).currentIndex, 2)
  assert.equal(createPresentationNavigation(3, -2).currentIndex, 0)
  assert.equal(createPresentationNavigation(3, 1.5).currentIndex, 0)
  assert.equal(createPresentationNavigation(3, 1, [2, 1, 0], 8).revealedEventCount, 1)
})

test("presentation navigation refuses empty or invalid slide counts", () => {
  assert.equal(createPresentationNavigation(0), null)
  assert.equal(createPresentationNavigation(1.5), null)
  assert.equal(createPresentationNavigation("2"), null)
})
