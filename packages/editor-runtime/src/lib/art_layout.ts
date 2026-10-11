// Elef Art fixed-host layout: eligibility math, offset measurement, and
// the shared ArtLayoutMonitor that settles each art root's layout mode.
// Both hosts boot the monitor (web through a thin Stimulus adapter, the
// desktop through the same client-mount token); the behavior lives here
// once. DOM-only: no host framework.
export interface SequenceEligibility {
  width: number
  itemCount: number
  density: string | null | undefined
  gap: number
  sequenceMinInline: number
}

export function sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline }: SequenceEligibility): boolean {
  if (density !== "compact" || itemCount < 2 || width <= 0) return false
  if (![width, gap, sequenceMinInline].every(Number.isFinite)) return false
  return (width - gap * (itemCount - 1)) / itemCount >= sequenceMinInline
}

export interface ArtOffset {
  left: number
  top: number
}

export function offsetWithin(root: Element | null, host: Element | null): ArtOffset | null {
  if (!root || !host) return null
  let left = 0
  let top = 0
  let current: Element | null = root
  while (current && current !== host) {
    left += Number((current as HTMLElement).offsetLeft) || 0
    top += Number((current as HTMLElement).offsetTop) || 0
    current = (current as HTMLElement).offsetParent
  }
  return current === host ? { left, top } : null
}

export interface ArtContainment {
  measurable: boolean
  fits: boolean
  reason: string | null
  origin?: ArtOffset
}

export function fixedArtContainment(root: Element | null, host: Element | null): ArtContainment {
  if (!root || !host) return { measurable: false, fits: false, reason: "missing-host" }
  const rootBox = root as HTMLElement
  const hostBox = host as HTMLElement
  if (hostBox.clientWidth <= 0 || hostBox.clientHeight <= 0 || rootBox.clientWidth <= 0) {
    return { measurable: false, fits: false, reason: "hidden" }
  }

  const origin = offsetWithin(root, host)
  if (!origin) return { measurable: true, fits: false, reason: "host-not-offset-parent" }

  const contained = (scroll: number, client: number): boolean => scroll <= client + 1
  const items = [...(root.querySelector(".elef-art-list")?.children ?? [])]
    .filter((item) => String(item.tagName).toLowerCase() === "li")
  const itemOverflow = items.some((item) => {
    const box = item as HTMLElement
    return !contained(box.scrollWidth, box.clientWidth) || !contained(box.scrollHeight, box.clientHeight)
  })
  const fits =
    contained(hostBox.scrollWidth, hostBox.clientWidth) &&
    contained(hostBox.scrollHeight, hostBox.clientHeight) &&
    contained(rootBox.scrollWidth, rootBox.clientWidth) &&
    contained(rootBox.scrollHeight, rootBox.clientHeight) &&
    origin.left + rootBox.offsetWidth <= hostBox.clientWidth + 1 &&
    origin.top + rootBox.offsetHeight <= hostBox.clientHeight + 1 &&
    !itemOverflow

  return { measurable: true, fits, reason: fits ? null : "overflow", origin }
}

const NO_FIT = "ART_NO_FIT"
const INTERNAL_ERROR = "ART_INTERNAL_ERROR"
const DYNAMIC_STATUSES = new Set(["pending", "ready", "fallback-no-fit"])
const ART_MESSAGES: Record<string, string> = Object.freeze({
  [NO_FIT]: "Art does not fit the fixed slide. All authored content remains available.",
  [INTERNAL_ERROR]: "Art could not measure its fixed host; the complete Markdown list remains available."
})
const FIXED_HOST_SELECTOR = '[data-art-host="fixed"]'
const ART_ROOT_SELECTOR = "[data-elef-art-root]"

export interface ArtDecision {
  root: Element
  host: Element | null
  desired?: string | null
  visible?: boolean
  failure?: string | null
}

// Lifecycle surface the Stimulus adapter re-exposes. The monitor routes its
// chained passes through the delegate so host adapters (and their lifecycle
// probes) observe every pass; standalone use leaves the delegate unset and
// the monitor chains to itself.
export interface ArtPassDelegate {
  runDecisionPass(): void
  runMeasurementPass(decisions: Array<ArtDecision>): void
  runFallbackMeasurement(decisions: Array<ArtDecision>): void
}

function parseCssPixels(value: string | null): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export class ArtLayoutMonitor {
  private readonly scope: Element
  private readonly delegate: ArtPassDelegate | null
  private active = false
  private trackedRoots: Array<Element> = []
  private observedElements = new Set<Element>()
  private dirtyRoots = new Set<Element>()
  private globalDirty = true
  private frame: number | null = null
  private readFrame: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private fontsReady: Promise<unknown> | null = null

  constructor(scope: Element, delegate: ArtPassDelegate | null = null) {
    this.scope = scope
    this.delegate = delegate
  }

  // Live roots under the scope; the adapter exposes this for lifecycle probes.
  get roots(): Array<Element> {
    return this.trackedRoots
  }

  get frameId(): number | null {
    return this.frame
  }

  get readFrameId(): number | null {
    return this.readFrame
  }

  private get passes(): ArtPassDelegate {
    return this.delegate ?? this
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.globalDirty = true
    this.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => this.scheduleHosts(entries.map((entry) => entry.target as Element)))
      : null
    this.mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver((records) => this.handleMutations(records))
      : null
    this.mutationObserver?.observe(this.scope, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    })
    const fonts = (globalThis.document as Document | undefined)?.fonts as
      | { ready?: Promise<unknown>; addEventListener?: (type: string, listener: () => void) => void } | undefined
    this.fontsReady = (fonts?.ready as Promise<unknown> | undefined) ?? null
    this.fontsReady?.then(() => this.schedule())
    fonts?.addEventListener?.("loadingdone", this.schedule)
    this.syncRoots()
    this.schedule()
  }

  destroy(): void {
    this.active = false
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    if (this.readFrame !== null) cancelAnimationFrame(this.readFrame)
    this.frame = null
    this.readFrame = null
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    const fonts = (globalThis.document as Document | undefined)?.fonts as
      | { removeEventListener?: (type: string, listener: () => void) => void } | undefined
    fonts?.removeEventListener?.("loadingdone", this.schedule)
  }

  syncRoots(): void {
    const next = [...this.scope.querySelectorAll(ART_ROOT_SELECTOR)]
    this.trackedRoots = next
    const nextObserved = new Set<Element>()
    for (const root of next) {
      const host = root.closest(FIXED_HOST_SELECTOR)
      if (host) nextObserved.add(host)
    }
    if (this.resizeObserver) {
      for (const element of this.observedElements) {
        if (!nextObserved.has(element)) this.resizeObserver.unobserve(element)
      }
      for (const element of nextObserved) {
        if (!this.observedElements.has(element)) this.resizeObserver.observe(element)
      }
    }
    this.observedElements = nextObserved
  }

  handleMutations(records: Array<MutationRecord>): void {
    this.syncRoots()
    const changedRoots = new Set<Element>()
    const changedHosts = new Set<Element>()
    let globalChange = false

    for (const record of records) {
      if (record.type === "attributes" && record.target === this.scope) {
        globalChange = true
        continue
      }

      const target = record.target.nodeType === 1 ? (record.target as Element) : (record.target.parentElement as Element | null)
      const root = target?.closest?.(ART_ROOT_SELECTOR) as Element | null
      if (root) {
        const host = root.closest(FIXED_HOST_SELECTOR)
        if (host) changedHosts.add(host)
        else changedRoots.add(root)
      } else {
        const host = target?.closest?.(FIXED_HOST_SELECTOR)
        if (host) changedHosts.add(host)
      }

      for (const node of [...(record.addedNodes || []), ...(record.removedNodes || [])]) {
        if (node.nodeType !== 1) continue
        const element = node as Element
        const roots = [
          ...(element.matches?.(ART_ROOT_SELECTOR) ? [element] : []),
          ...(element.querySelectorAll?.(ART_ROOT_SELECTOR) ?? [])
        ]
        for (const changedRoot of roots) {
          if (!this.trackedRoots.includes(changedRoot)) continue
          const host = changedRoot.closest(FIXED_HOST_SELECTOR)
          if (host) changedHosts.add(host)
          else changedRoots.add(changedRoot)
        }
      }
    }

    for (const host of changedHosts) {
      for (const root of this.trackedRoots) {
        if (root.closest(FIXED_HOST_SELECTOR) === host) changedRoots.add(root)
      }
    }
    if (globalChange) this.schedule()
    else if (changedRoots.size) this.schedule(changedRoots)
  }

  scheduleHosts(hosts: Array<Element>): void {
    const changedHosts = new Set(hosts)
    const changedRoots = this.trackedRoots.filter((root) => changedHosts.has(root.closest(FIXED_HOST_SELECTOR) as Element))
    if (changedRoots.length) this.schedule(changedRoots)
  }

  schedule = (roots: Iterable<Element> | null = null): void => {
    if (!this.active) return
    if (roots === null) this.globalDirty = true
    else for (const root of roots) this.dirtyRoots.add(root)
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => this.passes.runDecisionPass())
  }

  runDecisionPass(): void {
    this.frame = null
    if (!this.active || (!this.globalDirty && !this.dirtyRoots.size)) return
    this.syncRoots()
    const rootsToEvaluate = this.globalDirty ? new Set(this.trackedRoots) : this.dirtyRoots
    this.globalDirty = false
    this.dirtyRoots = new Set()
    const roots = this.trackedRoots.filter((root) => rootsToEvaluate.has(root) && DYNAMIC_STATUSES.has(root.getAttribute("data-art-status") ?? ""))
    if (!roots.length) return
    const hostWidths = new Map<Element, number>()
    const decisions: Array<ArtDecision> = roots.map((root) => {
      const host = root.closest(FIXED_HOST_SELECTOR)
      if (!host) return { root, host: null, desired: null, failure: INTERNAL_ERROR }
      if (!hostWidths.has(host)) hostWidths.set(host, (host as HTMLElement).clientWidth)
      const width = hostWidths.get(host) as number
      const tokens = getComputedStyle(root)
      const gap = parseCssPixels(tokens.getPropertyValue("--art-gap"))
      const sequenceMinInline = parseCssPixels(tokens.getPropertyValue("--art-sequence-min-inline"))
      const mode = root.getAttribute("data-art-mode")
      const density = root.getAttribute("data-art-density")
      const itemCount = [...(root.querySelector(".elef-art-list")?.children ?? [])]
        .filter((item) => String(item.tagName).toLowerCase() === "li").length
      const visible = width > 0 && (host as HTMLElement).clientHeight > 0 && (root as HTMLElement).clientWidth > 0
      let desired = root.getAttribute("data-art-layout")
      if (visible) {
        desired = mode === "peers"
          ? "peers-wrap"
          : sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline })
            ? "sequence-horizontal"
            : "sequence-vertical"
      }
      return { root, host, desired, visible, failure: null }
    })

    const hosts = new Set<Element>()
    for (const decision of decisions) {
      if (decision.host) hosts.add(decision.host)
      if (!decision.host) {
        this.setDiagnostic(decision.root, INTERNAL_ERROR)
        decision.root.setAttribute("data-art-layout", "plain-list")
        this.setStatus(decision.root, "error", true)
        continue
      }
      if (decision.failure) {
        this.setDiagnostic(decision.root, decision.failure)
        decision.root.setAttribute("data-art-layout", "plain-list")
        this.setStatus(decision.root, "error", true)
        continue
      }
      this.setDiagnostic(decision.root, null)
      this.setStatus(decision.root, "pending", false)
      if (decision.visible && decision.desired && decision.root.getAttribute("data-art-layout") !== decision.desired) {
        decision.root.setAttribute("data-art-layout", decision.desired)
      }
    }
    for (const host of hosts) host.setAttribute("data-art-overfull", "false")

    const measuredRoots = decisions.filter((decision) => decision.host && !decision.failure)
    this.readFrame = requestAnimationFrame(() => this.passes.runMeasurementPass(measuredRoots))
  }

  runMeasurementPass(decisions: Array<ArtDecision>): void {
    this.readFrame = null
    if (!this.active) return
    const horizontalFallbacks: Array<ArtDecision> = []
    const failedHosts = new Set<Element>()
    for (const decision of decisions) {
      const { root, host } = decision
      const result = fixedArtContainment(root, host)
      if (!result.measurable && result.reason === "hidden") {
        this.setStatus(root, "pending", false)
        continue
      }
      if (result.reason === "host-not-offset-parent") {
        this.setDiagnostic(root, INTERNAL_ERROR)
        this.setStatus(root, "error", true)
        continue
      }
      if (result.fits) {
        this.setDiagnostic(root, null)
        this.setStatus(root, "ready", true)
        continue
      }
      if (root.getAttribute("data-art-layout") === "sequence-horizontal") {
        horizontalFallbacks.push(decision)
        this.setStatus(root, "pending", false)
      } else {
        this.setDiagnostic(root, NO_FIT)
        this.setStatus(root, "fallback-no-fit", true)
        if (host) failedHosts.add(host)
      }
    }

    this.updateOverfull(failedHosts, decisions)
    if (!horizontalFallbacks.length) return

    for (const { root } of horizontalFallbacks) {
      root.setAttribute("data-art-layout", "sequence-vertical")
      this.setStatus(root, "pending", false)
    }
    this.readFrame = requestAnimationFrame(() => this.passes.runFallbackMeasurement(horizontalFallbacks))
  }

  runFallbackMeasurement(decisions: Array<ArtDecision>): void {
    this.readFrame = null
    if (!this.active) return
    const failedHosts = new Set<Element>()
    for (const { root, host } of decisions) {
      const result = fixedArtContainment(root, host)
      if (!result.measurable && result.reason === "hidden") {
        this.setStatus(root, "pending", false)
      } else if (result.reason === "host-not-offset-parent") {
        this.setDiagnostic(root, INTERNAL_ERROR)
        this.setStatus(root, "error", true)
      } else if (result.fits) {
        this.setDiagnostic(root, null)
        this.setStatus(root, "ready", true)
      } else {
        this.setDiagnostic(root, NO_FIT)
        this.setStatus(root, "fallback-no-fit", true)
        if (host) failedHosts.add(host)
      }
    }
    this.updateOverfull(failedHosts, decisions)
  }

  updateOverfull(failedHosts: Set<Element>, decisions: Array<ArtDecision>): void {
    const hosts = new Set(decisions.map((decision) => decision.host).filter(Boolean) as Array<Element>)
    for (const host of hosts) {
      const hasNoFit = this.trackedRoots.some((root) =>
        root.closest(FIXED_HOST_SELECTOR) === host &&
        root.getAttribute("data-art-status") === "fallback-no-fit"
      )
      host.setAttribute("data-art-overfull", failedHosts.has(host) || hasNoFit ? "true" : "false")
    }
  }

  setStatus(root: Element, status: string, settled: boolean): void {
    const wasSettled = root.getAttribute("data-art-settled") === "true"
    root.setAttribute("data-art-status", status)
    root.setAttribute("data-art-settled", String(settled))
    if (settled && !wasSettled) {
      root.dispatchEvent(new CustomEvent("elef:art-settled", {
        bubbles: true,
        detail: { status }
      }))
    }
  }

  setDiagnostic(root: Element, code: string | null): void {
    const previous = root.getAttribute("data-art-diagnostic") || null
    if (code) root.setAttribute("data-art-diagnostic", code)
    else root.removeAttribute("data-art-diagnostic")
    if (previous !== code) {
      root.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
        bubbles: true,
        detail: {
          code,
          message: code ? (ART_MESSAGES[code] ?? null) : null,
          blockId: root.closest("[data-editor-block-id]")?.getAttribute("data-editor-block-id") || null
        }
      }))
    }
  }
}
