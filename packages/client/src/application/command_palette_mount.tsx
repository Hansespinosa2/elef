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
    open() {
      if (open) return
      generation += 1
      open = true
      render()
      container.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
    },
    close,
    dispose() { open = false; root.unmount() },
  }
}
