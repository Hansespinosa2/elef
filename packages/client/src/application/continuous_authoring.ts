import { mountCommandPalette } from "@elef/client"
import type { EditorHandle } from "@elef/client/editor"
import { mountContinuousDocument } from "../features/editor/continuous_document.js"
import type { LibraryPaletteCommand } from "./types.js"

export { mountContinuousDocument } from "../features/editor/continuous_document.js"

// Compose the document surface and the existing shared command palette at
// the application boundary. Both hosts contribute save/navigation through
// their normal DOM adapters; the editor remains the sole owner of selection.
export async function mountContinuousAuthoring(editor: EditorHandle) {
  const surface = await mountContinuousDocument(editor)
  const form = editor.element.closest("form")
  if (!form) { surface.dispose(); throw new Error("Continuous authoring requires an editor form") }
  const document = editor.element.ownerDocument
  const mount = document.createElement("div")
  mount.dataset.continuousCommands = "true"
  const hint = document.createElement("button")
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  hint.type = "button"
  hint.className = "continuous-command-hint"
  hint.textContent = `Commands  ${mac ? "⌘K" : "Ctrl+K"}`
  hint.setAttribute("aria-label", `Open command palette (${mac ? "Command" : "Control"}+K)`)
  editor.element.append(hint)
  document.body.append(mount)
  let pending: (() => void) | null = null
  const command = (id: string, label: string, description: string, run: () => void): LibraryPaletteCommand => ({
    id, label, description, chord: null, run: () => { pending = run },
  })
  const click = (selector: string) => () => form.querySelector<HTMLElement>(selector)?.click()
  const editAction = (id: string) => click(`[data-edit-actions-row="${id}"]`)
  const commands = [
    command("save", "Save current work", "Save your changes", () => {
      const request = new CustomEvent("elef:save-request", { bubbles: true, cancelable: true })
      if (form.dispatchEvent(request)) form.requestSubmit()
    }),
    command("source", "Switch to source", "Edit Markdown source", click('[data-editor-target="sourceButton"]')),
    command("visual", "Switch to visual", "Edit the rendered document", click('[data-editor-target="visualButton"]')),
    command("vim", "Toggle Vim mode", "Turn Vim keybindings on or off", () => { editor.setVimEnabled(!editor.vimEnabled); editor.focus() }),
    command("controls", "Show editor controls", "Appearance, media, and editing options", () => {
      form.dataset.editorControls = "open"
      form.querySelector<HTMLElement>(".editor-toolbar summary, .editor-toolbar button")?.focus()
    }),
    command("hide-controls", "Hide editor controls", "Return to the document", () => { delete form.dataset.editorControls; editor.focus() }),
    command("export", "Export work", "Open export options", () => {
      form.dataset.editorControls = "open"
      document.querySelector<HTMLElement>('[data-controller="export-menu-host"] button, #export-menu-mount button')?.click()
    }),
    command("snippet", "Insert snippet or directive", "Open snippet suggestions", editAction("trigger:snippet")),
    command("link", "Insert document link", "Open link suggestions", editAction("trigger:link")),
    command("math", "Insert math shortcut", "Open equation suggestions", editAction("trigger:math")),
    command("diagram", "Insert diagram", "Open diagram suggestions", editAction("trigger:diagram")),
    command("media", "Add image", "Choose an image", editAction("media")),
    command("shortcuts", "Keyboard shortcuts", "Show the keyboard reference", () => {
      form.dataset.editorControls = "open"
      editAction("keyboard-shortcuts")()
    }),
    command("library", "Go to library", "Return to your works", () => document.querySelector<HTMLElement>("#back-to-library")?.click()),
    command("settings", "Open settings", "Change workspace settings", () => document.querySelector<HTMLElement>("#open-settings")?.click()),
  ].filter(entry => {
    const row = ({ snippet: "trigger:snippet", link: "trigger:link", math: "trigger:math", diagram: "trigger:diagram", media: "media", shortcuts: "keyboard-shortcuts" } as Record<string, string>)[entry.id]
    return !row || Boolean(form.querySelector(`[data-edit-actions-row="${row}"]`))
  })
  const palette = mountCommandPalette(mount, commands, () => {
    const action = pending
    pending = null
    if (action) queueMicrotask(action)
    else editor.focus()
  })
  const open = () => palette.open()
  hint.addEventListener("click", open)
  const keydown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k" &&
      !document.querySelector("dialog[open]")) {
      event.preventDefault()
      event.stopImmediatePropagation()
      open()
    }
  }
  document.addEventListener("keydown", keydown, true)
  form.dataset.editorFocus = "continuous"
  return { dispose() {
    document.removeEventListener("keydown", keydown, true)
    delete form.dataset.editorFocus
    delete form.dataset.editorControls
    palette.dispose()
    mount.remove()
    hint.remove()
    surface.dispose()
  } }
}
