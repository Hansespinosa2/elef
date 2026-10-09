// Vim editor preferences shared by the editor and settings controllers.
// Both surfaces read and write the same localStorage keys and must agree on how
// a keystroke is named, validated, and displayed, so the storage keys and the
// pure helpers around them live here rather than being copied per controller.

export const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled"
export const ESCAPE_KEY_STORAGE_KEY = "elef.editor.vim.escapeKey"
const LEGACY_ESCAPE_ALIAS_STORAGE_KEY = "elef.editor.vim.escapeAlias"
export const LINE_NUMBERS_STORAGE_KEY = "elef.editor.lineNumbers"
export const MODE_AWARE_CURSOR_STORAGE_KEY = "elef.editor.vim.modeAwareCursor"
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

function readValue(key) {
  try {
    return window.localStorage.getItem(key)
  } catch (_error) {
    return null
  }
}

export function writeValue(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch (_error) {
    // Private browsing and blocked storage should not disable editing.
  }
}

export function readBoolean(key) {
  return readValue(key) === "true"
}

export function writeBoolean(key, value) {
  writeValue(key, String(value))
}

function normalizeEscapeKey(value) {
  if (typeof value !== "string" || value.length === 0) return ""
  if (value.startsWith("<")) return /^(?:<(?:[CSMA]-)*[A-Za-z0-9]+>)+$/.test(value) ? value : ""
  return Array.from(value).length === 1 ? value : ""
}

export function normalizeLineNumberMode(value) {
  return ["absolute", "relative", "off"].includes(value) ? value : "absolute"
}

export function escapeKeyDisplay(key) {
  if (!key) return ""
  if (!key.startsWith("<")) return key

  return key.slice(1, -1).split("-").map((part) => VIM_MODIFIER_NAMES[part] || part).join("+")
}

export function vimKeyFromEvent(event) {
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

export function readEscapeKey() {
  const saved = readValue(ESCAPE_KEY_STORAGE_KEY)
  if (saved !== null) return normalizeEscapeKey(saved)

  return readValue(LEGACY_ESCAPE_ALIAS_STORAGE_KEY) === "shift-space" ? SHIFT_SPACE : ""
}

export function readLineNumberMode() {
  return normalizeLineNumberMode(readValue(LINE_NUMBERS_STORAGE_KEY) || "absolute")
}
