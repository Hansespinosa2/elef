import { Controller } from "@hotwired/stimulus"
import {
  ENABLED_STORAGE_KEY,
  ESCAPE_KEY_STORAGE_KEY,
  LINE_NUMBERS_STORAGE_KEY,
  MODE_AWARE_CURSOR_STORAGE_KEY,
  escapeKeyDisplay,
  normalizeLineNumberMode,
  readBoolean,
  readEscapeKey,
  readLineNumberMode,
  vimKeyFromEvent,
  writeBoolean,
  writeValue
} from "controllers/vim_preferences"

export default class extends Controller {
  static targets = ["vimToggle", "escapeKey", "lineNumbers", "modeAwareCursor"]

  connect() {
    this.vimEnabled = readBoolean(ENABLED_STORAGE_KEY)
    this.escapeKey = readEscapeKey()
    this.lineNumberMode = readLineNumberMode()
    this.modeAwareCursor = readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY)

    if (this.hasVimToggleTarget) this.vimToggleTarget.checked = this.vimEnabled
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = escapeKeyDisplay(this.escapeKey)
    if (this.hasLineNumbersTarget) this.lineNumbersTarget.value = this.lineNumberMode
    if (this.hasModeAwareCursorTarget) this.modeAwareCursorTarget.checked = this.modeAwareCursor
  }

  toggleVim(event) {
    this.vimEnabled = event.target.checked
    writeBoolean(ENABLED_STORAGE_KEY, this.vimEnabled)
  }

  captureEscapeKey(event) {
    const key = vimKeyFromEvent(event)
    if (!key) return

    event.preventDefault()
    event.stopPropagation()
    this.escapeKey = key
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = escapeKeyDisplay(key)
    writeValue(ESCAPE_KEY_STORAGE_KEY, key)
  }

  clearEscapeKey() {
    this.escapeKey = ""
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = ""
    writeValue(ESCAPE_KEY_STORAGE_KEY, "")
  }

  lineNumbersChanged(event) {
    this.lineNumberMode = normalizeLineNumberMode(event.target.value)
    writeValue(LINE_NUMBERS_STORAGE_KEY, this.lineNumberMode)
  }

  modeAwareCursorChanged(event) {
    this.modeAwareCursor = event.target.checked
    writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, this.modeAwareCursor)
  }
}
