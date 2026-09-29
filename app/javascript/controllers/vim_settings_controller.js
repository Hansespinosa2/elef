import { Controller } from "@hotwired/stimulus"

const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled"
const ESCAPE_KEY_STORAGE_KEY = "elef.editor.vim.escapeKey"
const LEGACY_ESCAPE_ALIAS_STORAGE_KEY = "elef.editor.vim.escapeAlias"
const LINE_NUMBERS_STORAGE_KEY = "elef.editor.lineNumbers"
const MODE_AWARE_CURSOR_STORAGE_KEY = "elef.editor.vim.modeAwareCursor"
const SHIFT_SPACE = "<S-Space>"

const VIM_KEY_NAMES = {
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backspace: "BS",
  Enter: "CR",
  Delete: "Del",
  Escape: "Esc",
  Insert: "Ins",
  PageDown: "PageDown",
  PageUp: "PageUp"
}

const VIM_MODIFIER_NAMES = { A: "Alt", C: "Ctrl", M: "Meta", S: "Shift" }

export default class extends Controller {
  static targets = ["vimToggle", "escapeKey", "lineNumbers", "modeAwareCursor"]

  connect() {
    this.vimEnabled = this.readBoolean(ENABLED_STORAGE_KEY)
    this.escapeKey = this.readEscapeKey()
    this.lineNumberMode = this.readLineNumberMode()
    this.modeAwareCursor = this.readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY)

    if (this.hasVimToggleTarget) this.vimToggleTarget.checked = this.vimEnabled
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = this.escapeKeyDisplay(this.escapeKey)
    if (this.hasLineNumbersTarget) this.lineNumbersTarget.value = this.lineNumberMode
    if (this.hasModeAwareCursorTarget) this.modeAwareCursorTarget.checked = this.modeAwareCursor
  }

  toggleVim(event) {
    this.vimEnabled = event.target.checked
    this.writeBoolean(ENABLED_STORAGE_KEY, this.vimEnabled)
  }

  captureEscapeKey(event) {
    const key = this.vimKeyFromEvent(event)
    if (!key) return

    event.preventDefault()
    event.stopPropagation()
    this.escapeKey = key
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = this.escapeKeyDisplay(key)
    this.writeValue(ESCAPE_KEY_STORAGE_KEY, key)
  }

  clearEscapeKey() {
    this.escapeKey = ""
    if (this.hasEscapeKeyTarget) this.escapeKeyTarget.value = ""
    this.writeValue(ESCAPE_KEY_STORAGE_KEY, "")
  }

  lineNumbersChanged(event) {
    this.lineNumberMode = this.normalizeLineNumberMode(event.target.value)
    this.writeValue(LINE_NUMBERS_STORAGE_KEY, this.lineNumberMode)
  }

  modeAwareCursorChanged(event) {
    this.modeAwareCursor = event.target.checked
    this.writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, this.modeAwareCursor)
  }

  readEscapeKey() {
    const saved = this.readValue(ESCAPE_KEY_STORAGE_KEY)
    if (saved !== null) return this.normalizeEscapeKey(saved)

    return this.readValue(LEGACY_ESCAPE_ALIAS_STORAGE_KEY) === "shift-space" ? SHIFT_SPACE : ""
  }

  readLineNumberMode() {
    return this.normalizeLineNumberMode(this.readValue(LINE_NUMBERS_STORAGE_KEY) || "absolute")
  }

  normalizeEscapeKey(value) {
    if (typeof value !== "string" || value.length === 0) return ""
    if (value.startsWith("<")) return /^(?:<(?:[CSMA]-)*[A-Za-z0-9]+>)+$/.test(value) ? value : ""
    return Array.from(value).length === 1 ? value : ""
  }

  vimKeyFromEvent(event) {
    if (["Shift", "Control", "Alt", "Meta", "Unidentified"].includes(event.key)) return ""

    const isLetter = /^[A-Za-z]$/.test(event.key)
    let key = VIM_KEY_NAMES[event.key] || event.key
    const modifiers = []
    if (event.ctrlKey) modifiers.push("C")
    if (event.shiftKey && (!Array.from(event.key).length || key.length > 1 || isLetter)) modifiers.push("S")
    if (event.altKey) modifiers.push("A")
    if (event.metaKey) modifiers.push("M")
    if (event.shiftKey && isLetter) key = key.toLowerCase()

    if (Array.from(key).length !== 1 || modifiers.length > 0) return `<${modifiers.join("-")}${modifiers.length ? "-" : ""}${key}>`
    return key
  }

  escapeKeyDisplay(key) {
    if (!key) return ""
    if (!key.startsWith("<")) return key

    return key.slice(1, -1).split("-").map((part) => VIM_MODIFIER_NAMES[part] || part).join("+")
  }

  normalizeLineNumberMode(value) {
    return ["absolute", "relative", "off"].includes(value) ? value : "absolute"
  }

  readBoolean(key) {
    return this.readValue(key) === "true"
  }

  readValue(key) {
    try {
      return window.localStorage.getItem(key)
    } catch (_error) {
      return null
    }
  }

  writeValue(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (_error) {
      // Private browsing and blocked storage should not disable editing.
    }
  }

  writeBoolean(key, value) {
    this.writeValue(key, String(value))
  }
}
