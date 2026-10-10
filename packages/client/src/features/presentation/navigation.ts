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
  next(): number
  previous(): number
  first(): number
  last(): number
}

export function createPresentationNavigation(slideCount: number, initialIndex = 0): PresentationNavigationState | null {
  if (!Number.isInteger(slideCount) || slideCount < 1) return null
  let currentIndex = Number.isInteger(initialIndex)
    ? Math.max(0, Math.min(initialIndex, slideCount - 1))
    : 0
  return {
    get currentIndex() { return currentIndex },
    next() { currentIndex = Math.min(currentIndex + 1, slideCount - 1); return currentIndex },
    previous() { currentIndex = Math.max(currentIndex - 1, 0); return currentIndex },
    first() { currentIndex = 0; return currentIndex },
    last() { currentIndex = slideCount - 1; return currentIndex }
  }
}
