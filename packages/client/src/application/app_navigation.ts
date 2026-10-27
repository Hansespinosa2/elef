export interface AppNavigationOptions {
  readonly libraryHref: string
  readonly settingsHref: string
  readonly active: "library" | "settings"
}

// One navigation component for both hosts. Hosts supply destinations and
// intercept navigation only when they own an in-application view lifecycle.
export function mountAppNavigation(element: HTMLElement, options: AppNavigationOptions): { dispose(): void } {
  const document = element.ownerDocument
  const identity = document.createElement("div")
  identity.className = "app-header-identity"
  const brand = document.createElement("a")
  brand.className = "brand no-underline"
  brand.href = options.libraryHref
  brand.textContent = "Elef"
  brand.setAttribute("aria-label", "Elef Library")
  identity.append(brand)
  const nav = document.createElement("nav")
  nav.className = "app-nav"
  nav.setAttribute("aria-label", "Primary")
  for (const [name, label, href, id] of [
    ["library", "Library", options.libraryHref, "back-to-library"],
    ["settings", "Settings", options.settingsHref, "open-settings"],
  ] as const) {
    const link = document.createElement("a")
    link.className = `app-nav-link${name === options.active ? " is-active" : ""}`
    link.id = id
    link.href = href
    link.textContent = label
    if (name === options.active) link.setAttribute("aria-current", "page")
    nav.append(link)
  }
  element.classList.add("app-navigation")
  element.replaceChildren(identity, nav)
  return { dispose() { element.replaceChildren() } }
}
