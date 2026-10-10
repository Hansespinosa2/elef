const PRESENTATION_KEY_ACTIONS = new Map<string, string>([
  ...["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].map((key): [string, string] => [key, "next"]),
  ...["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].map((key): [string, string] => [key, "previous"]),
  ["Home", "first"],
  ["End", "last"]
])

export function presentationActionForKey(key: string): string | null {
  return PRESENTATION_KEY_ACTIONS.get(key) || null
}

export interface PresentationNavigationState {
  readonly currentIndex: number
  readonly revealedEventCount: number
  readonly eventCount: number
  next(): number
  previous(): number
  first(): number
  last(): number
}

// Cumulative reveal events: each slide declares how many stepped reveal
// events it holds (via data-elef-reveal-event-count in the projection).
// next()/previous() walk one event at a time before changing slides, so
// present mode reveals bullet steps before advancing.
export function createPresentationNavigation(
  slideCount: number,
  initialIndex = 0,
  eventCounts: Array<number> = [],
  initialRevealedEventCount = 0
): PresentationNavigationState | null {
  if (!Number.isInteger(slideCount) || slideCount < 1) return null
  const counts = Array.from({ length: slideCount }, (_, index) => {
    const count = eventCounts[index] ?? 0
    return Number.isInteger(count) && count >= 0 ? count : 0
  })
  let currentIndex = Number.isInteger(initialIndex)
    ? Math.max(0, Math.min(initialIndex, slideCount - 1))
    : 0
  let revealedEventCount = Number.isInteger(initialRevealedEventCount)
    ? Math.max(0, Math.min(initialRevealedEventCount, counts[currentIndex] ?? 0))
    : 0
  return {
    get currentIndex() { return currentIndex },
    get revealedEventCount() { return revealedEventCount },
    get eventCount() { return counts[currentIndex] ?? 0 },
    next() {
      if (revealedEventCount < (counts[currentIndex] ?? 0)) revealedEventCount += 1
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
        revealedEventCount = counts[currentIndex] ?? 0
      }
      return currentIndex
    },
    first() { currentIndex = 0; revealedEventCount = 0; return currentIndex },
    last() { currentIndex = slideCount - 1; revealedEventCount = counts[currentIndex] ?? 0; return currentIndex }
  }
}
