import { mountEditActions, renderKeyboardReference, type EditActionsEditor, type EditActionsHost, type EditActionsMount } from "@elef/client"

// Host-side composition for the shared Edit-actions menu: the client
// session slice owns the menu, the shortcut feature owns the reference
// content, and the adapter wires them onto the source field of either
// visual editor (documents and presentations, web and desktop).
export function mountHostEditActions(
  form: Element,
  getEditor: () => EditActionsEditor | null,
  host: EditActionsHost
): EditActionsMount | null {
  const field = form.querySelector(".source-field") as HTMLElement | null
  if (!field) return null
  // Presentation forms run both the document and presentation adapters;
  // either may connect first, so the menu mount is idempotent (the loser
  // returns a no-op mount whose dispose must not remove the shared root).
  // The one exception is block structure: when the newcomer owns block
  // actions and the incumbent does not, the incumbent mount is disposed
  // and the menu remounts, so block rows are always present on
  // presentation forms regardless of connect order.
  const owner = field as HTMLElement & { editActionsMount?: EditActionsMount | null }
  const existing = field.querySelector(".edit-actions") as HTMLElement | null
  const offersBlocks = typeof (host as { applyVisualBlockAction?: unknown })?.applyVisualBlockAction === "function"
  if (existing) {
    if (offersBlocks && existing.dataset.editActionsBlocks !== "true") {
      if (owner.editActionsMount) owner.editActionsMount.dispose()
      else existing.remove()
      owner.editActionsMount = null
    } else {
      return { root: existing, dispose() {} }
    }
  }
  const mounted = mountEditActions({ field, getEditor, host, renderReference: renderKeyboardReference })
  if (mounted) owner.editActionsMount = mounted
  return mounted
}
