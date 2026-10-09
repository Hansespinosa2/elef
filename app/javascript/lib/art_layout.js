export function sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline }) {
  if (density !== "compact" || itemCount < 2 || width <= 0) return false
  if (![width, gap, sequenceMinInline].every(Number.isFinite)) return false
  return (width - gap * (itemCount - 1)) / itemCount >= sequenceMinInline
}

export function offsetWithin(root, host) {
  if (!root || !host) return null
  let left = 0
  let top = 0
  let current = root
  while (current && current !== host) {
    left += Number(current.offsetLeft) || 0
    top += Number(current.offsetTop) || 0
    current = current.offsetParent
  }
  return current === host ? { left, top } : null
}

export function fixedArtContainment(root, host) {
  if (!root || !host) return { measurable: false, fits: false, reason: "missing-host" }
  if (host.clientWidth <= 0 || host.clientHeight <= 0 || root.clientWidth <= 0) {
    return { measurable: false, fits: false, reason: "hidden" }
  }

  const origin = offsetWithin(root, host)
  if (!origin) return { measurable: true, fits: false, reason: "host-not-offset-parent" }

  const contained = (scroll, client) => scroll <= client + 1
  const items = [...(root.querySelector(".elef-art-list")?.children || [])]
    .filter(item => String(item.tagName).toLowerCase() === "li")
  const itemOverflow = items.some(item =>
    !contained(item.scrollWidth, item.clientWidth) ||
    !contained(item.scrollHeight, item.clientHeight)
  )
  const fits =
    contained(host.scrollWidth, host.clientWidth) &&
    contained(host.scrollHeight, host.clientHeight) &&
    contained(root.scrollWidth, root.clientWidth) &&
    contained(root.scrollHeight, root.clientHeight) &&
    origin.left + root.offsetWidth <= host.clientWidth + 1 &&
    origin.top + root.offsetHeight <= host.clientHeight + 1 &&
    !itemOverflow

  return { measurable: true, fits, reason: fits ? null : "overflow", origin }
}
