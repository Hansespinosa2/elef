import { Controller } from "@hotwired/stimulus"
import { fixedArtContainment, sequenceHorizontalEligible } from "lib/art_layout"

const NO_FIT = "ART_NO_FIT"
const INTERNAL_ERROR = "ART_INTERNAL_ERROR"
const DYNAMIC_STATUSES = new Set(["pending", "ready", "fallback-no-fit"])
const ART_MESSAGES = Object.freeze({
  [NO_FIT]: "Art does not fit the fixed slide. All authored content remains available.",
  [INTERNAL_ERROR]: "Art could not measure its fixed host; the complete Markdown list remains available."
})

export default class extends Controller {
  connect() {
    this.active = true
    this.roots = []
    this.observedElements = new Set()
    this.dirtyRoots = new Set()
    this.globalDirty = true
    this.frame = null
    this.readFrame = null
    this.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(entries => this.scheduleHosts(entries.map(entry => entry.target)))
      : null
    this.mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver(records => this.handleMutations(records))
      : null
    this.mutationObserver?.observe(this.element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    })
    this.fontsReady = document.fonts?.ready
    this.fontsReady?.then(() => this.schedule())
    document.fonts?.addEventListener?.("loadingdone", this.schedule)
    this.syncRoots()
    this.schedule()
  }

  disconnect() {
    this.active = false
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    if (this.readFrame !== null) cancelAnimationFrame(this.readFrame)
    this.frame = null
    this.readFrame = null
    this.resizeObserver?.disconnect()
    this.mutationObserver?.disconnect()
    document.fonts?.removeEventListener?.("loadingdone", this.schedule)
  }

  syncRoots() {
    const next = [...this.element.querySelectorAll("[data-elef-art-root]")]
    this.roots = next
    const nextObserved = new Set()
    for (const root of next) {
      const host = root.closest('[data-art-host="fixed"]')
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

  handleMutations(records) {
    this.syncRoots()
    const changedRoots = new Set()
    const changedHosts = new Set()
    let globalChange = false

    for (const record of records) {
      if (record.type === "attributes" && record.target === this.element) {
        globalChange = true
        continue
      }

      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
      const root = target?.closest?.("[data-elef-art-root]")
      if (root) {
        const host = root.closest('[data-art-host="fixed"]')
        if (host) changedHosts.add(host)
        else changedRoots.add(root)
      } else {
        const host = target?.closest?.('[data-art-host="fixed"]')
        if (host) changedHosts.add(host)
      }

      for (const node of [...(record.addedNodes || []), ...(record.removedNodes || [])]) {
        if (node.nodeType !== 1) continue
        const roots = [
          ...(node.matches?.("[data-elef-art-root]") ? [node] : []),
          ...node.querySelectorAll?.("[data-elef-art-root]") || []
        ]
        for (const changedRoot of roots) {
          if (!this.roots.includes(changedRoot)) continue
          const host = changedRoot.closest('[data-art-host="fixed"]')
          if (host) changedHosts.add(host)
          else changedRoots.add(changedRoot)
        }
      }
    }

    for (const host of changedHosts) {
      for (const root of this.roots) {
        if (root.closest('[data-art-host="fixed"]') === host) changedRoots.add(root)
      }
    }
    if (globalChange) this.schedule()
    else if (changedRoots.size) this.schedule(changedRoots)
  }

  scheduleHosts(hosts) {
    const changedHosts = new Set(hosts)
    const changedRoots = this.roots.filter(root => changedHosts.has(root.closest('[data-art-host="fixed"]')))
    if (changedRoots.length) this.schedule(changedRoots)
  }

  schedule = (roots = null) => {
    if (!this.active) return
    if (roots === null) this.globalDirty = true
    else for (const root of roots) this.dirtyRoots.add(root)
    if (this.frame !== null) return
    this.frame = requestAnimationFrame(() => this.runDecisionPass())
  }

  runDecisionPass() {
    this.frame = null
    if (!this.active || (!this.globalDirty && !this.dirtyRoots.size)) return
    this.syncRoots()
    const rootsToEvaluate = this.globalDirty ? new Set(this.roots) : this.dirtyRoots
    this.globalDirty = false
    this.dirtyRoots = new Set()
    const roots = this.roots.filter(root => rootsToEvaluate.has(root) && DYNAMIC_STATUSES.has(root.dataset.artStatus))
    if (!roots.length) return
    const hostWidths = new Map()
    const decisions = roots.map(root => {
      const host = root.closest('[data-art-host="fixed"]')
      if (!host) return { root, host: null, desired: null, failure: INTERNAL_ERROR }
      if (!hostWidths.has(host)) hostWidths.set(host, host.clientWidth)
      const width = hostWidths.get(host)
      const tokens = getComputedStyle(root)
      const gap = parseCssPixels(tokens.getPropertyValue("--art-gap"))
      const sequenceMinInline = parseCssPixels(tokens.getPropertyValue("--art-sequence-min-inline"))
      const mode = root.dataset.artMode
      const density = root.dataset.artDensity
      const itemCount = [...(root.querySelector(".elef-art-list")?.children || [])]
        .filter(item => String(item.tagName).toLowerCase() === "li").length
      const visible = width > 0 && host.clientHeight > 0 && root.clientWidth > 0
      let desired = root.dataset.artLayout
      if (visible) {
        desired = mode === "peers"
          ? "peers-wrap"
          : sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline })
            ? "sequence-horizontal"
            : "sequence-vertical"
      }
      return { root, host, desired, visible, failure: null }
    })

    const hosts = new Set()
    for (const decision of decisions) {
      if (decision.host) hosts.add(decision.host)
      if (!decision.host) {
        this.setDiagnostic(decision.root, INTERNAL_ERROR)
        decision.root.dataset.artLayout = "plain-list"
        this.setStatus(decision.root, "error", true)
        continue
      }
      if (decision.failure) {
        this.setDiagnostic(decision.root, decision.failure)
        decision.root.dataset.artLayout = "plain-list"
        this.setStatus(decision.root, "error", true)
        continue
      }
      this.setDiagnostic(decision.root, null)
      this.setStatus(decision.root, "pending", false)
      if (decision.visible && decision.desired && decision.root.dataset.artLayout !== decision.desired) {
        decision.root.dataset.artLayout = decision.desired
      }
    }
    for (const host of hosts) host.dataset.artOverfull = "false"

    const measuredRoots = decisions.filter(decision => decision.host && !decision.failure)
    this.readFrame = requestAnimationFrame(() => this.runMeasurementPass(measuredRoots))
  }

  runMeasurementPass(decisions) {
    this.readFrame = null
    if (!this.active) return
    const horizontalFallbacks = []
    const failedHosts = new Set()
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
      if (root.dataset.artLayout === "sequence-horizontal") {
        horizontalFallbacks.push(decision)
        this.setStatus(root, "pending", false)
      } else {
        this.setDiagnostic(root, NO_FIT)
        this.setStatus(root, "fallback-no-fit", true)
        failedHosts.add(host)
      }
    }

    this.updateOverfull(failedHosts, decisions)
    if (!horizontalFallbacks.length) return

    for (const { root } of horizontalFallbacks) {
      root.dataset.artLayout = "sequence-vertical"
      this.setStatus(root, "pending", false)
    }
    this.readFrame = requestAnimationFrame(() => this.runFallbackMeasurement(horizontalFallbacks))
  }

  runFallbackMeasurement(decisions) {
    this.readFrame = null
    if (!this.active) return
    const failedHosts = new Set()
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
        failedHosts.add(host)
      }
    }
    this.updateOverfull(failedHosts, decisions)
  }

  updateOverfull(failedHosts, decisions) {
    const hosts = new Set(decisions.map(decision => decision.host).filter(Boolean))
    for (const host of hosts) {
      const hasNoFit = this.roots.some(root =>
        root.closest('[data-art-host="fixed"]') === host &&
        root.dataset.artStatus === "fallback-no-fit"
      )
      host.dataset.artOverfull = failedHosts.has(host) || hasNoFit ? "true" : "false"
    }
  }

  setStatus(root, status, settled) {
    const wasSettled = root.dataset.artSettled === "true"
    root.dataset.artStatus = status
    root.dataset.artSettled = String(settled)
    if (settled && !wasSettled) {
      root.dispatchEvent(new CustomEvent("elef:art-settled", {
        bubbles: true,
        detail: { status }
      }))
    }
  }

  setDiagnostic(root, code) {
    const previous = root.dataset.artDiagnostic || null
    if (code) root.dataset.artDiagnostic = code
    else delete root.dataset.artDiagnostic
    if (previous !== code) {
      root.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
        bubbles: true,
        detail: {
          code,
          message: code ? ART_MESSAGES[code] : null,
          blockId: root.closest("[data-editor-block-id]")?.dataset.editorBlockId || null
        }
      }))
    }
  }
}

function parseCssPixels(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
