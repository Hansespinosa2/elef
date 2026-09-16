import { Controller } from "@hotwired/stimulus"

const MODIFIER_ORDER = ["hat", "tilde", "b", "T"]
const MODIFIERS = {
  hat: (value) => `\\hat{${value}}`,
  tilde: (value) => `\\tilde{${value}}`,
  b: (value) => `\\mathbf{${value}}`,
  T: (value) => `${value}^{\\mathsf{T}}`
}

export function expandMathShorthand(token) {
  const match = token.match(/^([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z][A-Za-z0-9]*))*$/)
  if (!match) return null

  const modifiers = token.split(".").slice(1)
  if (modifiers.length === 0 || modifiers.some((modifier) => !MODIFIERS[modifier])) return null
  if (new Set(modifiers).size !== modifiers.length) return null

  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
    .reduce((value, modifier) => MODIFIERS[modifier](value), token.split(".")[0])
}

export function insideMath(text, caret) {
  const before = text.slice(0, caret)
  if (insideFencedCode(before) || insideInlineCode(before)) return false

  let delimiter = null
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === "\\") {
      index += 1
      continue
    }
    if (before.startsWith("$$", index)) {
      delimiter = delimiter === "$$" ? null : delimiter || "$$"
      index += 1
    } else if (before[index] === "$") {
      delimiter = delimiter === "$" ? null : delimiter || "$"
    }
  }
  return delimiter !== null
}

function insideFencedCode(text) {
  let marker = null
  text.replace(/^\s{0,3}(`{3,}|~{3,}).*$/gm, (_line, fence) => {
    const current = { character: fence[0], length: fence.length }
    if (marker && marker.character === current.character && current.length >= marker.length) marker = null
    else if (!marker) marker = current
    return _line
  })
  return marker !== null
}

function insideInlineCode(text) {
  let ticks = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "`" || text[index - 1] === "\\") continue
    ticks += 1
  }
  return ticks % 2 === 1
}

export default class extends Controller {
  static targets = ["editor"]

  keydown(event) {
    if (!["Enter", "Tab"].includes(event.key)) return

    const editor = this.editorTarget
    if (editor.selectionStart !== editor.selectionEnd) return
    const caret = editor.selectionStart
    if (!insideMath(editor.value, caret)) return

    const before = editor.value.slice(0, caret)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)$/)
    if (!match) return

    const expansion = expandMathShorthand(match[1])
    if (!expansion) return

    event.preventDefault()
    editor.setRangeText(expansion, caret - match[1].length, caret, "end")
    editor.dispatchEvent(new Event("input", { bubbles: true }))
  }
}
