export function createPresentationNavigation(slideCount) {
  if (!Number.isInteger(slideCount) || slideCount < 1) return null
  let currentIndex = 0
  return {
    get currentIndex() { return currentIndex },
    next() { currentIndex = Math.min(currentIndex + 1, slideCount - 1); return currentIndex },
    previous() { currentIndex = Math.max(currentIndex - 1, 0); return currentIndex },
    first() { currentIndex = 0; return currentIndex },
    last() { currentIndex = slideCount - 1; return currentIndex }
  }
}
