// Persist the user's visibility choice across host navigation and reloads.
// Storage may be unavailable (for example in a restricted browser context).
const boundInputs = new WeakSet<HTMLInputElement>()

export function setupAppToolbar(root: ParentNode = document): void {
  const input = root.querySelector<HTMLInputElement>("#app-toolbar-visible")
  if (!input || boundInputs.has(input)) return
  boundInputs.add(input)
  try { input.checked = sessionStorage.getItem("elef.toolbar.visible") !== "false" } catch { /* Use the visible default. */ }
  input.addEventListener("change", () => {
    try { sessionStorage.setItem("elef.toolbar.visible", String(input.checked)) } catch { /* Visibility still works for this page. */ }
  })
}
