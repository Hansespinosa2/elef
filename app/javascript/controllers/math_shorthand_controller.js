import { Controller } from "@hotwired/stimulus"
import { syntaxTree } from "@codemirror/language"
import { editorFor } from "controllers/editor_controller"

const MODIFIER_ALIASES = Object.freeze({ b: "bold", bb: "blackboard", cal: "calligraphic", calligraphic: "calligraphic", rm: "roman", roman: "roman", bar: "bar", vec: "vector", v: "vector", hat: "hat", tilde: "tilde", t: "transpose", T: "transpose", inv: "inverse" })
const GREEK_OPERAND = /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/
const ATOMIC_MATH_SHORTCUTS = Object.freeze({ "@a": "\\alpha", "@b": "\\beta", "@g": "\\gamma", "@m": "\\mu", "@n": "\\nu", "@r": "\\rho", "@q": "\\theta", "@D": "\\Delta" })
const ATOMIC_LATEX_COMMANDS = new Set(["nabla", "partial", "infty", "ell", "hbar", "Re", "Im", "wp"])
const ATOMIC_LATEX_WRAPPERS = new Set(["mathbf", "boldsymbol", "mathbb", "mathcal", "mathfrak", "mathit", "mathrm", "mathsf", "mathtt", "vec", "bar", "hat", "tilde", "overline", "underline"])

export function parseMathShorthand(token) {
  const operandNode = parseMathOperandAt(token, 0)
  if (!operandNode) return null
  const base = token.slice(0, operandNode.end)
  const suffix = token.slice(operandNode.end)
  if (!/^(?:\.[A-Za-z]+)+$/.test(suffix)) return null

  const names = suffix.slice(1).split(".")
  const modifiers = names.map((name) => MODIFIER_ALIASES[name] || null)
  if (modifiers.some((modifier) => !modifier)) return null
  if (modifiers.filter((modifier) => ["bold", "blackboard", "calligraphic", "roman"].includes(modifier)).length > 1 || modifiers.filter((modifier) => ["bar", "vector", "hat", "tilde"].includes(modifier)).length > 1 || modifiers.filter((modifier) => ["transpose", "inverse"].includes(modifier)).length > 2 || modifiers.filter((modifier) => modifier === "transpose").length > 1 || modifiers.filter((modifier) => modifier === "inverse").length > 1) {
    return { status: "invalid", base, modifiers }
  }

  const operand = ATOMIC_MATH_SHORTCUTS[base] || operandNode.tex
  const style = modifiers.find((modifier) => ["bold", "blackboard", "calligraphic", "roman"].includes(modifier))
  const decoration = modifiers.find((modifier) => ["bar", "vector", "hat", "tilde"].includes(modifier))
  let value = style === "bold" ? `${GREEK_OPERAND.test(operand) ? "\\boldsymbol" : "\\mathbf"}{${operand}}` : style === "blackboard" ? `\\mathbb{${operand}}` : style === "calligraphic" ? `\\mathcal{${operand}}` : style === "roman" ? `\\mathrm{${operand}}` : operand
  if (decoration) value = `\\${decoration === "vector" ? "vec" : decoration}{${value}}`
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

function parseMathOperandAt(source, start) {
  const character = source[start]
  if (character === "@") {
    const match = source.slice(start).match(/^@[A-Za-z][A-Za-z0-9]*/)
    if (!match) return null
    return { end: start + match[0].length, tex: ATOMIC_MATH_SHORTCUTS[match[0]] || match[0] }
  }

  if (character === "\\") {
    const match = source.slice(start).match(/^\\([A-Za-z]+)/)
    if (!match) return null
    const command = match[1]
    const commandEnd = start + match[0].length
    if (ATOMIC_LATEX_WRAPPERS.has(command)) {
      if (source[commandEnd] !== "{") return null
      const inner = parseMathOperandAt(source, commandEnd + 1)
      if (!inner || source[inner.end] !== "}") return null
      const end = inner.end + 1
      return { end, tex: source.slice(start, end) }
    }
    if (!GREEK_OPERAND.test(match[0]) && !ATOMIC_LATEX_COMMANDS.has(command)) return null
    return { end: commandEnd, tex: match[0] }
  }

  if (/[A-Za-z]/.test(character || "")) return { end: start + 1, tex: character }
  return null
}

export function expandMathShorthand(token) {
  const parsed = parseMathShorthand(token)
  return parsed?.status === "valid" ? parsed.expansion : null
}

export function mathShorthandAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  if (!insideMath(text, caret)) return null
  const tokenCharacter = /[A-Za-z0-9.@\\{}]/
  let start = caret
  let end = caret
  while (start > 0 && tokenCharacter.test(text[start - 1])) start -= 1
  while (end < text.length && tokenCharacter.test(text[end])) end += 1
  const source = text.slice(start, end)
  const parsed = parseMathShorthand(source)
  return parsed ? { ...parsed, start, end, source } : null
}

export function mathShorthandAtEditor(editor, caret) {
  const doc = editor?.view?.state?.doc
  if (!doc || caret < 0 || caret > doc.length || !editorInsideMath(editor, caret)) return null
  const line = doc.lineAt(caret)
  const localCaret = caret - line.from
  const tokenCharacter = /[A-Za-z0-9.@\\{}]/
  let start = localCaret
  let end = localCaret
  while (start > 0 && tokenCharacter.test(line.text[start - 1])) start -= 1
  while (end < line.text.length && tokenCharacter.test(line.text[end])) end += 1
  const source = line.text.slice(start, end)
  const parsed = parseMathShorthand(source)
  return parsed ? { ...parsed, start: line.from + start, end: line.from + end, source } : null
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

function syntaxAncestors(editor, caret) {
  const state = editor?.view?.state
  if (!state) return []
  const position = Math.max(0, Math.min(caret, state.doc.length))
  const node = syntaxTree(state).resolveInner(position, -1)
  const ancestors = []
  for (let current = node; current; current = current.parent) ancestors.push(current)
  return ancestors
}

export function editorSourceContextAt(editor, caret) {
  const state = editor?.view?.state
  if (!state) {
    const line = editor?.value?.split("\n").at(-1) || ""
    return sourceContextAt(line, line.length)
  }

  const ancestors = syntaxAncestors(editor, caret)
  const inlineCode = ancestors.some((node) => node.name === "InlineCode")
  if (inlineCode) return "code_span"

  const fencedCode = ancestors.find((node) => node.name === "FencedCode")
  if (!fencedCode) return null
  const openingLine = state.doc.lineAt(fencedCode.from).text
  const info = openingLine.match(/^[ \t]{0,3}(?:`{3,}|~{3,})(.*)$/)?.[1]?.trim() || ""
  return /^mermaid(?:\s|$)/i.test(info) ? "mermaid" : "code_fence"
}

export function editorInsideCode(editor, caret) {
  return editorSourceContextAt(editor, caret) !== null
}

export function editorMathContextAt(editor, caret) {
  const state = editor?.view?.state
  if (!state) {
    const text = editor?.value || ""
    return mathContextAt(text, caret)
  }
  if (caret < 0 || caret > state.doc.length || editorInsideCode(editor, caret)) return null

  const paragraph = syntaxAncestors(editor, caret).find((node) => node.name === "Paragraph")
  const line = state.doc.lineAt(caret)
  const from = paragraph?.from ?? line.from
  const prefix = state.doc.sliceString(from, caret, "\n")
  return mathContextAt(prefix, prefix.length)
}

export function editorInsideMath(editor, caret) {
  return editorMathContextAt(editor, caret) !== null
}

function mathDollarActionAtEditor(editor, caret) {
  const state = editor?.view?.state
  if (!state) return mathDollarAction(editor?.value || "", caret)
  if (editorInsideCode(editor, caret)) return "literal"
  const line = state.doc.lineAt(caret)
  const localCaret = caret - line.from
  if (escapedAt(line.text.slice(0, localCaret), localCaret)) return "literal"

  const before = state.doc.sliceString(Math.max(0, caret - 2), caret, "\n")
  const after = state.doc.sliceString(caret, Math.min(state.doc.length, caret + 2), "\n")
  if (before.endsWith("$") && after.startsWith("$") && !(before.endsWith("$$") && after.startsWith("$$"))) return "promote"
  if (state.doc.sliceString(caret, caret + 1) === "$" && editorInsideMath(editor, caret)) return "skip"
  return "pair"
}

export default class extends Controller {
  static targets = ["editor"]

  connect() {
    this.lastExpansion = null
    this.editorController = editorFor(this.element)
    this.editorReady = () => { this.editorController ||= editorFor(this.element); this.setupEditor() }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
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
  }

  setupEditor() {
    this.editorController ||= editorFor(this.element)
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.handleEditorKeyup = (event) => {
        if (this.isEditingKey(event)) {
          this.pendingChain = mathShorthandAtEditor(this.editorController, this.editorController.selectionStart)
          return
        }
        this.leaveChainAfterCursorMove()
      }
      this.handleEditorMousedown = () => { this.pendingChain = mathShorthandAtEditor(this.editorController, this.editorController.selectionStart) }
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
    if (!editor || editor.editingMode !== "source" || !editor.insertMode) return
    const caret = editor.selectionStart
    const plainEnter = event.key === "Enter" && !event.isComposing && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (plainEnter && editor.selectionStart === editor.selectionEnd) {
      const line = editor.view?.state?.doc.lineAt(caret)
      if (line?.text === "$$$$" && caret - line.from === 2 && editorMathContextAt(editor, caret) === "display_math") {
        event.preventDefault()
        const separator = editor.lineSeparator || "\n"
        editor.replaceRange(`${separator}${separator}`, caret, caret)
        editor.setSelectionRange(caret + separator.length)
        return
      }
    }
    if (event.key === "$" && editor.selectionStart === editor.selectionEnd) {
      const action = mathDollarActionAtEditor(editor, caret)
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
    this.pendingChain = mathShorthandAtEditor(editor, caret)
    if (!this.pendingChain || this.pendingChain.status !== "valid" || editor.selectionStart !== editor.selectionEnd) return

    if (event.key === " " || event.code === "Space" || event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const suffix = event.key === " " || event.code === "Space" ? " " : event.key === "Enter" ? editor.lineSeparator : ""
      this.commit(this.pendingChain, suffix)
    }
  }

  isEditingKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    return event.key?.length === 1 || ["Backspace", "Delete"].includes(event.key)
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
    const caret = editor.selectionStart
    if (editor.selectionStart === editor.selectionEnd && caret >= chain.start && caret <= chain.end) return
    this.pendingChain = null
    this.commit(chain)
  }

  commitAll() {
    const editor = this.editorController
    if (!editor?.value) return
    const source = editor.value
    const chainPattern = /(?:@[A-Za-z][A-Za-z0-9]*|\\[A-Za-z]+|[A-Za-z])[A-Za-z0-9.@\\{}]*/g
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
    return mathShorthandAtEditor(editor, caret)?.status === "valid"
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
