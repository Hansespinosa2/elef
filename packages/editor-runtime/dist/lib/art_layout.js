function sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline }) {
  if (density !== "compact" || itemCount < 2 || width <= 0) return false;
  if (![width, gap, sequenceMinInline].every(Number.isFinite)) return false;
  return (width - gap * (itemCount - 1)) / itemCount >= sequenceMinInline;
}
function offsetWithin(root, host) {
  if (!root || !host) return null;
  let left = 0;
  let top = 0;
  let current = root;
  while (current && current !== host) {
    left += Number(current.offsetLeft) || 0;
    top += Number(current.offsetTop) || 0;
    current = current.offsetParent;
  }
  return current === host ? { left, top } : null;
}
function fixedArtContainment(root, host) {
  if (!root || !host) return { measurable: false, fits: false, reason: "missing-host" };
  const rootBox = root;
  const hostBox = host;
  if (hostBox.clientWidth <= 0 || hostBox.clientHeight <= 0 || rootBox.clientWidth <= 0) {
    return { measurable: false, fits: false, reason: "hidden" };
  }
  const origin = offsetWithin(root, host);
  if (!origin) return { measurable: true, fits: false, reason: "host-not-offset-parent" };
  const contained = (scroll, client) => scroll <= client + 1;
  const items = [...root.querySelector(".elef-art-list")?.children ?? []].filter((item) => String(item.tagName).toLowerCase() === "li");
  const itemOverflow = items.some((item) => {
    const box = item;
    return !contained(box.scrollWidth, box.clientWidth) || !contained(box.scrollHeight, box.clientHeight);
  });
  const fits = contained(hostBox.scrollWidth, hostBox.clientWidth) && contained(hostBox.scrollHeight, hostBox.clientHeight) && contained(rootBox.scrollWidth, rootBox.clientWidth) && contained(rootBox.scrollHeight, rootBox.clientHeight) && origin.left + rootBox.offsetWidth <= hostBox.clientWidth + 1 && origin.top + rootBox.offsetHeight <= hostBox.clientHeight + 1 && !itemOverflow;
  return { measurable: true, fits, reason: fits ? null : "overflow", origin };
}
const NO_FIT = "ART_NO_FIT";
const INTERNAL_ERROR = "ART_INTERNAL_ERROR";
const DYNAMIC_STATUSES = /* @__PURE__ */ new Set(["pending", "ready", "fallback-no-fit"]);
const ART_MESSAGES = Object.freeze({
  [NO_FIT]: "Art does not fit the fixed slide. All authored content remains available.",
  [INTERNAL_ERROR]: "Art could not measure its fixed host; the complete Markdown list remains available."
});
const FIXED_HOST_SELECTOR = '[data-art-host="fixed"]';
const ART_ROOT_SELECTOR = "[data-elef-art-root]";
function parseCssPixels(value) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
class ArtLayoutMonitor {
  scope;
  active = false;
  roots = [];
  observedElements = /* @__PURE__ */ new Set();
  dirtyRoots = /* @__PURE__ */ new Set();
  globalDirty = true;
  frame = null;
  readFrame = null;
  resizeObserver = null;
  mutationObserver = null;
  fontsReady = null;
  constructor(scope) {
    this.scope = scope;
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.globalDirty = true;
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => this.scheduleHosts(entries.map((entry) => entry.target))) : null;
    this.mutationObserver = typeof MutationObserver === "function" ? new MutationObserver((records) => this.handleMutations(records)) : null;
    this.mutationObserver?.observe(this.scope, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    const fonts = globalThis.document?.fonts;
    this.fontsReady = fonts?.ready ?? null;
    this.fontsReady?.then(() => this.schedule());
    fonts?.addEventListener?.("loadingdone", this.schedule);
    this.syncRoots();
    this.schedule();
  }
  destroy() {
    this.active = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.readFrame !== null) cancelAnimationFrame(this.readFrame);
    this.frame = null;
    this.readFrame = null;
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    const fonts = globalThis.document?.fonts;
    fonts?.removeEventListener?.("loadingdone", this.schedule);
  }
  syncRoots() {
    const next = [...this.scope.querySelectorAll(ART_ROOT_SELECTOR)];
    this.roots = next;
    const nextObserved = /* @__PURE__ */ new Set();
    for (const root of next) {
      const host = root.closest(FIXED_HOST_SELECTOR);
      if (host) nextObserved.add(host);
    }
    if (this.resizeObserver) {
      for (const element of this.observedElements) {
        if (!nextObserved.has(element)) this.resizeObserver.unobserve(element);
      }
      for (const element of nextObserved) {
        if (!this.observedElements.has(element)) this.resizeObserver.observe(element);
      }
    }
    this.observedElements = nextObserved;
  }
  handleMutations(records) {
    this.syncRoots();
    const changedRoots = /* @__PURE__ */ new Set();
    const changedHosts = /* @__PURE__ */ new Set();
    let globalChange = false;
    for (const record of records) {
      if (record.type === "attributes" && record.target === this.scope) {
        globalChange = true;
        continue;
      }
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const root = target?.closest?.(ART_ROOT_SELECTOR);
      if (root) {
        const host = root.closest(FIXED_HOST_SELECTOR);
        if (host) changedHosts.add(host);
        else changedRoots.add(root);
      } else {
        const host = target?.closest?.(FIXED_HOST_SELECTOR);
        if (host) changedHosts.add(host);
      }
      for (const node of [...record.addedNodes || [], ...record.removedNodes || []]) {
        if (node.nodeType !== 1) continue;
        const element = node;
        const roots = [
          ...element.matches?.(ART_ROOT_SELECTOR) ? [element] : [],
          ...element.querySelectorAll?.(ART_ROOT_SELECTOR) ?? []
        ];
        for (const changedRoot of roots) {
          if (!this.roots.includes(changedRoot)) continue;
          const host = changedRoot.closest(FIXED_HOST_SELECTOR);
          if (host) changedHosts.add(host);
          else changedRoots.add(changedRoot);
        }
      }
    }
    for (const host of changedHosts) {
      for (const root of this.roots) {
        if (root.closest(FIXED_HOST_SELECTOR) === host) changedRoots.add(root);
      }
    }
    if (globalChange) this.schedule();
    else if (changedRoots.size) this.schedule(changedRoots);
  }
  scheduleHosts(hosts) {
    const changedHosts = new Set(hosts);
    const changedRoots = this.roots.filter((root) => changedHosts.has(root.closest(FIXED_HOST_SELECTOR)));
    if (changedRoots.length) this.schedule(changedRoots);
  }
  schedule = (roots = null) => {
    if (!this.active) return;
    if (roots === null) this.globalDirty = true;
    else for (const root of roots) this.dirtyRoots.add(root);
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => this.runDecisionPass());
  };
  runDecisionPass() {
    this.frame = null;
    if (!this.active || !this.globalDirty && !this.dirtyRoots.size) return;
    this.syncRoots();
    const rootsToEvaluate = this.globalDirty ? new Set(this.roots) : this.dirtyRoots;
    this.globalDirty = false;
    this.dirtyRoots = /* @__PURE__ */ new Set();
    const roots = this.roots.filter((root) => rootsToEvaluate.has(root) && DYNAMIC_STATUSES.has(root.getAttribute("data-art-status") ?? ""));
    if (!roots.length) return;
    const hostWidths = /* @__PURE__ */ new Map();
    const decisions = roots.map((root) => {
      const host = root.closest(FIXED_HOST_SELECTOR);
      if (!host) return { root, host: null, desired: null, failure: INTERNAL_ERROR };
      if (!hostWidths.has(host)) hostWidths.set(host, host.clientWidth);
      const width = hostWidths.get(host);
      const tokens = getComputedStyle(root);
      const gap = parseCssPixels(tokens.getPropertyValue("--art-gap"));
      const sequenceMinInline = parseCssPixels(tokens.getPropertyValue("--art-sequence-min-inline"));
      const mode = root.getAttribute("data-art-mode");
      const density = root.getAttribute("data-art-density");
      const itemCount = [...root.querySelector(".elef-art-list")?.children ?? []].filter((item) => String(item.tagName).toLowerCase() === "li").length;
      const visible = width > 0 && host.clientHeight > 0 && root.clientWidth > 0;
      let desired = root.getAttribute("data-art-layout");
      if (visible) {
        desired = mode === "peers" ? "peers-wrap" : sequenceHorizontalEligible({ width, itemCount, density, gap, sequenceMinInline }) ? "sequence-horizontal" : "sequence-vertical";
      }
      return { root, host, desired, visible, failure: null };
    });
    const hosts = /* @__PURE__ */ new Set();
    for (const decision of decisions) {
      if (decision.host) hosts.add(decision.host);
      if (!decision.host) {
        this.setDiagnostic(decision.root, INTERNAL_ERROR);
        decision.root.setAttribute("data-art-layout", "plain-list");
        this.setStatus(decision.root, "error", true);
        continue;
      }
      if (decision.failure) {
        this.setDiagnostic(decision.root, decision.failure);
        decision.root.setAttribute("data-art-layout", "plain-list");
        this.setStatus(decision.root, "error", true);
        continue;
      }
      this.setDiagnostic(decision.root, null);
      this.setStatus(decision.root, "pending", false);
      if (decision.visible && decision.desired && decision.root.getAttribute("data-art-layout") !== decision.desired) {
        decision.root.setAttribute("data-art-layout", decision.desired);
      }
    }
    for (const host of hosts) host.setAttribute("data-art-overfull", "false");
    const measuredRoots = decisions.filter((decision) => decision.host && !decision.failure);
    this.readFrame = requestAnimationFrame(() => this.runMeasurementPass(measuredRoots));
  }
  runMeasurementPass(decisions) {
    this.readFrame = null;
    if (!this.active) return;
    const horizontalFallbacks = [];
    const failedHosts = /* @__PURE__ */ new Set();
    for (const decision of decisions) {
      const { root, host } = decision;
      const result = fixedArtContainment(root, host);
      if (!result.measurable && result.reason === "hidden") {
        this.setStatus(root, "pending", false);
        continue;
      }
      if (result.reason === "host-not-offset-parent") {
        this.setDiagnostic(root, INTERNAL_ERROR);
        this.setStatus(root, "error", true);
        continue;
      }
      if (result.fits) {
        this.setDiagnostic(root, null);
        this.setStatus(root, "ready", true);
        continue;
      }
      if (root.getAttribute("data-art-layout") === "sequence-horizontal") {
        horizontalFallbacks.push(decision);
        this.setStatus(root, "pending", false);
      } else {
        this.setDiagnostic(root, NO_FIT);
        this.setStatus(root, "fallback-no-fit", true);
        if (host) failedHosts.add(host);
      }
    }
    this.updateOverfull(failedHosts, decisions);
    if (!horizontalFallbacks.length) return;
    for (const { root } of horizontalFallbacks) {
      root.setAttribute("data-art-layout", "sequence-vertical");
      this.setStatus(root, "pending", false);
    }
    this.readFrame = requestAnimationFrame(() => this.runFallbackMeasurement(horizontalFallbacks));
  }
  runFallbackMeasurement(decisions) {
    this.readFrame = null;
    if (!this.active) return;
    const failedHosts = /* @__PURE__ */ new Set();
    for (const { root, host } of decisions) {
      const result = fixedArtContainment(root, host);
      if (!result.measurable && result.reason === "hidden") {
        this.setStatus(root, "pending", false);
      } else if (result.reason === "host-not-offset-parent") {
        this.setDiagnostic(root, INTERNAL_ERROR);
        this.setStatus(root, "error", true);
      } else if (result.fits) {
        this.setDiagnostic(root, null);
        this.setStatus(root, "ready", true);
      } else {
        this.setDiagnostic(root, NO_FIT);
        this.setStatus(root, "fallback-no-fit", true);
        if (host) failedHosts.add(host);
      }
    }
    this.updateOverfull(failedHosts, decisions);
  }
  updateOverfull(failedHosts, decisions) {
    const hosts = new Set(decisions.map((decision) => decision.host).filter(Boolean));
    for (const host of hosts) {
      const hasNoFit = this.roots.some(
        (root) => root.closest(FIXED_HOST_SELECTOR) === host && root.getAttribute("data-art-status") === "fallback-no-fit"
      );
      host.setAttribute("data-art-overfull", failedHosts.has(host) || hasNoFit ? "true" : "false");
    }
  }
  setStatus(root, status, settled) {
    const wasSettled = root.getAttribute("data-art-settled") === "true";
    root.setAttribute("data-art-status", status);
    root.setAttribute("data-art-settled", String(settled));
    if (settled && !wasSettled) {
      root.dispatchEvent(new CustomEvent("elef:art-settled", {
        bubbles: true,
        detail: { status }
      }));
    }
  }
  setDiagnostic(root, code) {
    const previous = root.getAttribute("data-art-diagnostic") || null;
    if (code) root.setAttribute("data-art-diagnostic", code);
    else root.removeAttribute("data-art-diagnostic");
    if (previous !== code) {
      root.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
        bubbles: true,
        detail: {
          code,
          message: code ? ART_MESSAGES[code] ?? null : null,
          blockId: root.closest("[data-editor-block-id]")?.getAttribute("data-editor-block-id") || null
        }
      }));
    }
  }
}
export {
  ArtLayoutMonitor,
  fixedArtContainment,
  offsetWithin,
  sequenceHorizontalEligible
};
