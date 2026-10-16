import { Controller } from "@hotwired/stimulus"
import { mountEditor } from "@elef/client/editor"
import type { EditorHandle } from "@elef/client/editor"

// Mount/lifecycle and declarative action adapter only. The client owns the
// editing session and the exact same engine is consumed by both hosts.
export default class extends Controller<HTMLElement> {
  private editor: EditorHandle | undefined

  connect(): void { this.editor = mountEditor({ element: this.element }) }
  disconnect(): void { this.editor?.dispose(); this.editor = undefined }
  showVisual(event?: Event): void { this.editor?.showVisual(event) }
  showSource(event?: Event): void { this.editor?.showSource(event) }
  toggleMetadataVisibility(): void { this.editor?.toggleMetadataVisibility() }
  toggleVim(event: Event | boolean): void { this.editor?.toggleVim(event) }
  captureEscapeKey(event: KeyboardEvent): void { this.editor?.captureEscapeKey(event) }
  clearEscapeKey(): void { this.editor?.clearEscapeKey() }
  lineNumbersChanged(event: Event): void { this.editor?.lineNumbersChanged(event) }
  modeAwareCursorChanged(event: Event): void { this.editor?.modeAwareCursorChanged(event) }
  sync(): void { this.editor?.sync() }
}
