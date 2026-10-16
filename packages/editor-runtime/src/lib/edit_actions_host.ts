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
  return mountEditActions({ field, getEditor, host, renderReference: renderKeyboardReference })
}
