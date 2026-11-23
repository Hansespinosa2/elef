import { createElement } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CommandPalette } from "../features/library/CommandPalette.js"
import type { LibraryPaletteCommand } from "./types.js"

// Mount the same command surface outside the library, using the React copy
// that owns it. The host supplies actions; this adapter owns no persistence.
export function mountCommandPalette(container: HTMLElement, commands: readonly LibraryPaletteCommand[], onClose: () => void) {
  const root = createRoot(container)
  let open = false
  let generation = 0
  const render = () => flushSync(() => root.render(createElement(CommandPalette, {
    key: generation, open, initialMode: "commands", commands, works: [], searchAvailable: false,
    onOpenWork: () => {}, onClose: close,
  })))
  function close() { if (open) { open = false; render(); onClose() } }
  render()
  return {
    open(trigger?: HTMLElement) {
      if (open) return
      const previouslyFocused = container.ownerDocument.activeElement
      generation += 1
      const openedGeneration = generation
      open = true
      render()
      container.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
      // Some WebKit activations restore focus to the triggering button after
      // its click handler finishes. Correct that on the next frame, but do
      // not steal focus if the user has already moved somewhere else.
      requestAnimationFrame(() => {
        const active = container.ownerDocument.activeElement
        if (open && generation === openedGeneration && (active === previouslyFocused || active === trigger)) {
          container.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
        }
      })
    },
    close,
    dispose() { open = false; root.unmount() },
  }
}
