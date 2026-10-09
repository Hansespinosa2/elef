const PRESENTATION_KEY_ACTIONS = new Map([
  ...["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].map(key => [key, "next"]),
  ...["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].map(key => [key, "previous"]),
  ["Home", "first"],
  ["End", "last"]
])

export function presentationActionForKey(key) {
  return PRESENTATION_KEY_ACTIONS.get(key) || null
}

export function createPresentationNavigation(slideCount, initialIndex = 0, eventCounts = [], initialRevealedEventCount = 0) {
  if (!Number.isInteger(slideCount) || slideCount < 1) return null
  const counts = Array.from({ length: slideCount }, (_, index) => {
    const count = eventCounts[index] ?? 0
    return Number.isInteger(count) && count >= 0 ? count : 0
  })
  let currentIndex = Number.isInteger(initialIndex)
    ? Math.max(0, Math.min(initialIndex, slideCount - 1))
    : 0
  let revealedEventCount = Number.isInteger(initialRevealedEventCount)
    ? Math.max(0, Math.min(initialRevealedEventCount, counts[currentIndex]))
    : 0
  return {
    get currentIndex() { return currentIndex },
    get revealedEventCount() { return revealedEventCount },
    get eventCount() { return counts[currentIndex] },
    next() {
      if (revealedEventCount < counts[currentIndex]) revealedEventCount += 1
      else if (currentIndex < slideCount - 1) {
        currentIndex += 1
        revealedEventCount = 0
      }
      return currentIndex
    },
    previous() {
      if (revealedEventCount > 0) revealedEventCount -= 1
      else if (currentIndex > 0) {
        currentIndex -= 1
        revealedEventCount = counts[currentIndex]
      }
      return currentIndex
    },
    first() { currentIndex = 0; revealedEventCount = 0; return currentIndex },
    last() { currentIndex = slideCount - 1; revealedEventCount = counts[currentIndex]; return currentIndex }
  }
}
