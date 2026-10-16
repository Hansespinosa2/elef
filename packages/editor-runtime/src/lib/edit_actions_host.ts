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
  const existing = field.querySelector(".edit-actions") as HTMLElement | null
  if (existing) {
    return { root: existing, dispose() {} }
  }
  return mountEditActions({ field, getEditor, host, renderReference: renderKeyboardReference })
}
