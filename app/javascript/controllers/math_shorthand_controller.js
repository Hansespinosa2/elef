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
  let delimiter = null
  let fence = null
  let inlineCodeLength = null

  for (const line of before.split("\n")) {
    const fenceMatch = line.match(/^\s{0,3}([`~]{3,})/)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      continue
    }

    for (let index = 0; index < line.length;) {
      if (line[index] === "\\") {
        index += 2
        continue
      }

      if (line[index] === "`") {
        let length = 1
        while (line[index + length] === "`") length += 1
        if (inlineCodeLength === null) inlineCodeLength = length
        else if (inlineCodeLength === length) inlineCodeLength = null
        index += length
        continue
      }

      if (inlineCodeLength !== null) {
        index += 1
        continue
      }

      if (line.startsWith("$$", index)) {
        delimiter = delimiter === "$$" ? null : delimiter || "$$"
        index += 2
      } else if (line[index] === "$") {
        delimiter = delimiter === "$" ? null : delimiter || "$"
        index += 1
      } else {
        index += 1
      }
    }
  }
  return delimiter !== null
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
