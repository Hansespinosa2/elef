import { Controller } from "@hotwired/stimulus"
import "elef-renderer"
import { authoringSettingsElements, createAuthoringSettingsDialog } from "lib/authoring_settings_dialog"
import { createRailsAuthoringSettingsTransport } from "lib/rails_authoring_settings_transport"

export default class extends Controller {
  static values = {
    registry: String,
    openNew: Boolean,
    entryId: String,
    snippetsUrl: String,
    mathShortcutsUrl: String,
    closeUrl: String
  }

  connect() {
    if (!this.dialog) {
      const transport = createRailsAuthoringSettingsTransport({
        snippetsUrl: this.snippetsUrlValue,
        mathShortcutsUrl: this.mathShortcutsUrlValue
      })
      this.dialog = createAuthoringSettingsDialog({
        elements: authoringSettingsElements(this.element),
        ...transport,
        reloadEditorRegistry: async () => {},
        renderMarkdownBlock: source => globalThis.ElefRenderer.renderMarkdownBlock(source),
        onClose: () => {
          if (this.closeUrlValue && this.element.isConnected) window.location.assign(this.closeUrlValue)
        }
      })
    }
    void this.dialog.open({
      registry: this.registryValue,
      openNew: this.openNewValue,
      entryId: this.entryIdValue || null
    })
  }
}
