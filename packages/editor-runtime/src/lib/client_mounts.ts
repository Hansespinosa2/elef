// Shared host seam for neutral client mount contracts: elements bearing
// `data-client-mount="<token> …"` declare behavior mounts without naming the
// host framework. The host translates tokens to its Stimulus controllers so
// both hosts boot the same mounts; Stimulus picks up the translated
// attributes through its own mutation observation.
const MOUNT_CONTROLLERS: Record<string, string> = {
  mermaid: "mermaid-diagrams",
  "document-pages": "document-pages"
}

export function clientMountController(token: string): string | null {
  return MOUNT_CONTROLLERS[token] ?? null
}

export function translateElementMounts(element: Element): boolean {
  const mounts = (element.getAttribute?.("data-client-mount") || "").split(/\s+/).filter(Boolean)
  const controllers = mounts.flatMap((mount) => clientMountController(mount) ?? [])
  if (!controllers.length) return false
  const existing = (element.getAttribute("data-controller") || "").split(/\s+/).filter(Boolean)
  controllers.forEach((identifier) => {
    if (!existing.includes(identifier)) existing.push(identifier)
  })
  element.setAttribute("data-controller", existing.join(" "))
  return true
}

export function translateClientMounts(root: Document | Element | null | undefined): number {
  if (!root?.querySelectorAll) return 0
  let translated = 0
  if ((root as Element).hasAttribute?.("data-client-mount") && translateElementMounts(root as Element)) translated += 1
  root.querySelectorAll("[data-client-mount]").forEach((element) => {
    if (translateElementMounts(element)) translated += 1
  })
  return translated
}

const startedTargets = new WeakSet()

export function startClientMounts(target: Document | Element | null = globalThis.document ?? null): boolean {
  if (!target || typeof MutationObserver === "undefined" || startedTargets.has(target)) return false
  startedTargets.add(target)
  translateClientMounts(target)
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        if (mutation.attributeName === "data-client-mount" && mutation.target.nodeType === 1) {
          translateElementMounts(mutation.target as Element)
        }
        return
      }
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return
        translateClientMounts(node as Element)
      })
    })
  }).observe((target as Document).documentElement ?? target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-client-mount"]
  })
  return true
}
