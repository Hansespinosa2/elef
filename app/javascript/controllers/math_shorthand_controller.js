import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"

const MODIFIER_ALIASES = Object.freeze({ b: "bold", bb: "blackboard", vec: "vector", v: "vector", t: "transpose", T: "transpose", inv: "inverse" })
const GREEK_OPERAND = /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/
const ATOMIC_MATH_SHORTCUTS = Object.freeze({ "@a": "\\alpha", "@b": "\\beta", "@g": "\\gamma", "@m": "\\mu", "@n": "\\nu", "@r": "\\rho", "@D": "\\Delta" })

export function parseMathShorthand(token) {
  const match = token.match(/^(@[A-Za-z][A-Za-z0-9]*|\\[A-Za-z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*)(?:\.[A-Za-z]+)+$/)
  if (!match) return null

  const [base, ...names] = token.split(".")
  const modifiers = names.map((name) => MODIFIER_ALIASES[name] || null)
  if (modifiers.some((modifier) => !modifier)) return null
  if (modifiers.filter((modifier) => ["bold", "blackboard"].includes(modifier)).length > 1 || modifiers.filter((modifier) => modifier === "vector").length > 1 || modifiers.filter((modifier) => ["transpose", "inverse"].includes(modifier)).length > 2 || modifiers.filter((modifier) => modifier === "transpose").length > 1 || modifiers.filter((modifier) => modifier === "inverse").length > 1) {
    return { status: "invalid", base, modifiers }
  }

  const operand = ATOMIC_MATH_SHORTCUTS[base] || base
  const style = modifiers.find((modifier) => ["bold", "blackboard"].includes(modifier))
  const vector = modifiers.includes("vector")
  let value = style === "bold" ? `${GREEK_OPERAND.test(operand) ? "\\boldsymbol" : "\\mathbf"}{${operand}}` : style === "blackboard" ? `\\mathbb{${operand}}` : operand
  if (vector) value = `\\vec{${value}}`
  let postfixCount = 0
  for (const modifier of modifiers) {
    if (modifier === "transpose" || modifier === "inverse") {
      const operand = postfixCount === 0 ? value : `\\left(${value}\\right)`
      value = modifier === "transpose" ? `${operand}^{\\mathsf{T}}` : `${operand}^{-1}`
      postfixCount += 1
    }
  }
  return { status: "valid", base, modifiers, expansion: value }
}

export function expandMathShorthand(token) {
  const parsed = parseMathShorthand(token)
  return parsed?.status === "valid" ? parsed.expansion : null
}

export function mathShorthandAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  if (!insideMath(text, caret)) return null
  const tokenCharacter = /[A-Za-z0-9.@\\]/
  let start = caret
  let end = caret
  while (start > 0 && tokenCharacter.test(text[start - 1])) start -= 1
  while (end < text.length && tokenCharacter.test(text[end])) end += 1
  const source = text.slice(start, end)
  const parsed = parseMathShorthand(source)
  return parsed ? { ...parsed, start, end, source } : null
}

export function mathContextAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  let delimiter = null
  let fence = null
  let inlineCodeLength = null

  for (const line of before.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}([`~]{3,})(.*)$/)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && /^[ \t]*$/.test(fenceMatch[2])) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      continue
    }

    for (let index = 0; index < line.length;) {
      if (inlineCodeLength === null && line.startsWith("\\(", index)) {
        delimiter = delimiter === "\\)" ? null : delimiter || "\\)"
        index += 2
        continue
      }

      if (inlineCodeLength === null && line.startsWith("\\[", index)) {
        delimiter = delimiter === "\\]" ? null : delimiter || "\\]"
        index += 2
        continue
      }

      if (inlineCodeLength === null && (line.startsWith("\\)", index) || line.startsWith("\\]", index))) {
        const closing = line.slice(index, index + 2)
        if (delimiter === closing) delimiter = null
        index += 2
        continue
      }

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
  if (delimiter === null) return null
  return delimiter === "$$" || delimiter === "\\[" ? "display_math" : "inline_math"
}

export function insideMath(text, caret) {
  return mathContextAt(text, caret) !== null
}

export function sourceContextAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  let fence = null
  let inlineCodeLength = null
  for (const line of before.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}([`~]{3,})(.*)$/)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && /^[ \t]*$/.test(fenceMatch[2])) fence = null
      continue
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length, info: fenceMatch[2].trim() }
      continue
    }
    for (let index = 0; index < line.length;) {
      if (line[index] === "\\") { index += 2; continue }
      if (line[index] !== "`") { index += 1; continue }
      let length = 1
      while (line[index + length] === "`") length += 1
      if (inlineCodeLength === null) inlineCodeLength = length
      else if (inlineCodeLength === length) inlineCodeLength = null
      index += length
    }
  }
  if (fence) return /^mermaid(?:\s|$)/i.test(fence.info) ? "mermaid" : "code_fence"
  return inlineCodeLength !== null ? "code_span" : null
}

export function insideCode(text, caret) {
  return sourceContextAt(text, caret) !== null
}

export default class extends Controller {
  static targets = ["editor"]

  connect() {
    this.lastExpansion = null
    this.editorController = editorFor(this.element)
    this.editorReady = () => { this.editorController ||= editorFor(this.element); this.setupEditor() }
    this.beforeSave = () => this.commitAll()
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.element.addEventListener("elef:before-save", this.beforeSave)
    this.setupEditor()
  }

  disconnect() {
    if (this.editorController && this.keydownBound) {
      this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
      this.editorController.dom.removeEventListener("keyup", this.handleEditorKeyup, true)
      this.editorController.dom.removeEventListener("mousedown", this.handleEditorMousedown, true)
      this.editorController.dom.removeEventListener("click", this.handleEditorClick, true)
      this.editorController.dom.removeEventListener("focusout", this.handleEditorFocusout, true)
      this.editorController.form?.removeEventListener("submit", this.handleFormSubmit, true)
    }
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
    this.element.removeEventListener("elef:before-save", this.beforeSave)
  }

  setupEditor() {
    this.editorController ||= editorFor(this.element)
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.handleEditorKeyup = () => this.leaveChainAfterCursorMove()
      this.handleEditorMousedown = () => { this.pendingChain = mathShorthandAt(this.editorController.value, this.editorController.selectionStart) }
      this.handleEditorClick = () => queueMicrotask(() => this.leaveChainAfterCursorMove())
      this.handleEditorFocusout = () => this.commitAll()
      this.handleFormSubmit = () => this.commitAll()
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.editorController.dom.addEventListener("keyup", this.handleEditorKeyup, true)
      this.editorController.dom.addEventListener("mousedown", this.handleEditorMousedown, true)
      this.editorController.dom.addEventListener("click", this.handleEditorClick, true)
      this.editorController.dom.addEventListener("focusout", this.handleEditorFocusout, true)
      this.editorController.form?.addEventListener("submit", this.handleFormSubmit, true)
      this.keydownBound = true
    }
  }

  keydown(event) {
    if (event.defaultPrevented || event.elefMathShorthandHandled) return
    const editor = this.editorController
    if (!editor || !editor.insertMode) return
    const caret = editor.selectionStart
    if (event.key === "$" && editor.selectionStart === editor.selectionEnd) {
      const action = mathDollarAction(editor.value, caret)
      if (action === "promote") {
        event.preventDefault()
        editor.replaceRange("$$$$", caret - 1, caret + 1)
        editor.setSelectionRange(caret + 1, caret + 1)
        return
      } else if (action === "skip") {
        event.preventDefault()
        editor.setSelectionRange(caret + 1, caret + 1)
        return
      } else if (action === "pair") {
        event.preventDefault()
        editor.replaceRange("$$", caret, caret)
        editor.setSelectionRange(caret + 1, caret + 1)
        return
      }
    }
    this.pendingChain = mathShorthandAt(editor.value, caret)
    if (!this.pendingChain || this.pendingChain.status !== "valid" || editor.selectionStart !== editor.selectionEnd) return

    if (event.key === " " || event.code === "Space" || event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const suffix = event.key === " " || event.code === "Space" ? " " : event.key === "Enter" ? editor.lineSeparator : ""
      this.commit(this.pendingChain, suffix)
    }
  }

  commit(chain, suffix = "") {
    if (!chain || chain.status !== "valid") return false
    this.editorController.replaceRange(`${chain.expansion}${suffix}`, chain.start, chain.end)
    this.pendingChain = null
    return true
  }

  leaveChainAfterCursorMove() {
    const chain = this.pendingChain
    const editor = this.editorController
    if (!chain || !editor) return
    this.pendingChain = null
    const caret = editor.selectionStart
    if (editor.selectionStart === editor.selectionEnd && caret >= chain.start && caret <= chain.end) return
    this.commit(chain)
  }

  commitAll() {
    const editor = this.editorController
    if (!editor?.value) return
    const source = editor.value
    const chainPattern = /(?:@[A-Za-z][A-Za-z0-9]*|\\[A-Za-z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*)(?:\.[A-Za-z]+)+/g
    const changes = []
    for (const match of source.matchAll(chainPattern)) {
      const from = match.index
      const to = from + match[0].length
      const chain = mathShorthandAt(source, to)
      if (chain?.status === "valid" && chain.start === from) changes.push({ from, to, insert: chain.expansion })
    }
    if (changes.length) editor.replaceRanges(changes)
  }

  hasRecognizedAppendedModifiers(editor, caret) {
    return mathShorthandAt(editor.value, caret)?.status === "valid"
  }
}

function escapedAt(text, position) {
  let slashes = 0
  for (let index = position - 1; index >= 0 && text[index] === "\\"; index -= 1) slashes += 1
  return slashes % 2 === 1
}

export function mathDollarAction(text, caret) {
  if (insideCode(text, caret) || escapedAt(text, caret)) return "literal"
  if (text[caret - 1] === "$" && text[caret] === "$" && !(text[caret - 2] === "$" && text[caret + 1] === "$")) return "promote"
  if (text[caret] === "$" && insideMath(text, caret)) return "skip"
  return "pair"
}
