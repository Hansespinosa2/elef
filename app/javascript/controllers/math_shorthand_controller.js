import { Controller } from "@hotwired/stimulus"
import { syntaxTree } from "@codemirror/language"
import { editorFor } from "controllers/editor_controller"

const GREEK_OPERAND = /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/
const ATOMIC_MATH_SHORTCUTS = Object.freeze({ "@a": "\\alpha", "@b": "\\beta", "@g": "\\gamma", "@m": "\\mu", "@n": "\\nu", "@q": "\\theta", "@r": "\\rho", "@D": "\\Delta" })
const ATOMIC_LATEX_COMMANDS = new Set(["nabla", "partial", "infty", "ell", "hbar", "Re", "Im", "wp"])
const ATOMIC_LATEX_WRAPPERS = new Set(["mathbf", "boldsymbol", "mathbb", "mathcal", "mathfrak", "mathit", "mathrm", "mathsf", "mathtt", "vec", "bar", "hat", "tilde", "overline", "underline"])

const MODIFIER_CLASSES = Object.freeze([
  Object.freeze({
    name: "font",
    max: 1,
    modifiers: Object.freeze({
      bold: Object.freeze({ aliases: ["b"], wrappers: ["mathbf", "boldsymbol"], command: "mathbf" }),
      blackboard: Object.freeze({ aliases: ["bb"], wrappers: ["mathbb"], command: "mathbb" }),
      calligraphic: Object.freeze({ aliases: ["cal", "calligraphic"], wrappers: ["mathcal"], command: "mathcal" }),
      roman: Object.freeze({ aliases: ["rm", "roman"], wrappers: ["mathrm"], command: "mathrm" })
    })
  }),
  Object.freeze({
    name: "accent",
    max: 1,
    modifiers: Object.freeze({
      bar: Object.freeze({ aliases: ["bar"], wrappers: ["bar"], command: "bar" }),
      vector: Object.freeze({ aliases: ["vec", "v"], wrappers: ["vec"], command: "vec" }),
      hat: Object.freeze({ aliases: ["hat"], wrappers: ["hat"], command: "hat" }),
      tilde: Object.freeze({ aliases: ["tilde"], wrappers: ["tilde"], command: "tilde" })
    })
  }),
  Object.freeze({
    name: "transpose",
    max: 1,
    modifiers: Object.freeze({ transpose: Object.freeze({ aliases: ["t", "T"], postfix: "^{\\mathsf{T}}" }) })
  }),
  Object.freeze({
    name: "inverse",
    max: 1,
    modifiers: Object.freeze({ inverse: Object.freeze({ aliases: ["inv"], postfix: "^{-1}" }) })
  })
])

const MODIFIER_DEFINITIONS = Object.freeze(Object.fromEntries(
  MODIFIER_CLASSES.flatMap(({ name: className, modifiers }) => Object.entries(modifiers).map(([name, definition]) => [name, { ...definition, className }]))
))
const MODIFIER_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(MODIFIER_DEFINITIONS).flatMap(([name, definition]) => definition.aliases.map((alias) => [alias, name]))
))
const MODIFIER_WRAPPERS = Object.freeze(Object.fromEntries(
  Object.entries(MODIFIER_DEFINITIONS).flatMap(([name, definition]) => (definition.wrappers || []).map((wrapper) => [wrapper, name]))
))

/** `base` is the innermost atomic operand; recognized wrappers and postfixes are stored in `modifiers`. */
export function parseMathShorthand(token) {
  if (typeof token !== "string") return null

  const suffix = token.match(/(?:\.[A-Za-z]+)*$/)?.[0] || ""
  const head = token.slice(0, token.length - suffix.length)
  const parsedHead = parseExpandedMathHead(head)
  if (!parsedHead) return null

  const names = suffix ? suffix.slice(1).split(".") : []
  const appendedModifiers = names.map((name) => MODIFIER_ALIASES[name] || null)
  if (appendedModifiers.some((modifier) => !modifier)) return null

  const modifiers = [...parsedHead.modifiers, ...appendedModifiers]
  if (modifiers.length === 0) return null
  if (!modifiersWithinClassLimits(modifiers)) return { status: "invalid", base: parsedHead.base, modifiers }

  return {
    status: "valid",
    base: parsedHead.base,
    modifiers,
    expansion: expandMathModifiers(parsedHead.operand, modifiers)
  }
}

function parseExpandedMathHead(head) {
  let source = head
  let unwrappedGroup = false
  const outerPostfixes = []

  while (source) {
    const postfix = trailingMathPostfix(source)
    if (postfix) {
      outerPostfixes.push(postfix)
      source = source.slice(0, source.length - MODIFIER_DEFINITIONS[postfix].postfix.length)
      continue
    }

    if (source.startsWith("\\left(") && source.endsWith("\\right)")) {
      if (unwrappedGroup) return null
      source = source.slice("\\left(".length, -"\\right)".length)
      unwrappedGroup = true
      continue
    }
    break
  }

  const wrapperModifiers = []
  while (source.startsWith("\\")) {
    const wrapper = source.match(/^\\([A-Za-z]+)\{/)
    if (!wrapper) break
    const open = wrapper[0].length - 1
    const close = matchingMathBrace(source, open)
    if (close !== source.length - 1) return null

    const modifier = MODIFIER_WRAPPERS[wrapper[1]]
    if (!modifier) return null
    wrapperModifiers.push(modifier)
    source = source.slice(open + 1, close)
  }

  const operandNode = parseMathOperandAt(source, 0)
  if (!operandNode || operandNode.end !== source.length) return null
  const base = source.slice(0, operandNode.end)
  const operand = ATOMIC_MATH_SHORTCUTS[base] || operandNode.tex
  return { base, operand, modifiers: [...wrapperModifiers, ...outerPostfixes.reverse()] }
}

function trailingMathPostfix(source) {
  return Object.entries(MODIFIER_DEFINITIONS).find(([, definition]) => definition.postfix && source.endsWith(definition.postfix))?.[0] || null
}

function matchingMathBrace(source, open) {
  if (source[open] !== "{") return -1
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "\\") {
      if (/[A-Za-z]/.test(source[index + 1] || "")) {
        index += 1
        while (/[A-Za-z]/.test(source[index + 1] || "")) index += 1
      } else {
        index += 1
      }
      continue
    }
    if (source[index] === "{") depth += 1
    else if (source[index] === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function modifiersWithinClassLimits(modifiers) {
  return MODIFIER_CLASSES.every(({ max, modifiers: classModifiers }) => {
    const members = new Set(Object.keys(classModifiers))
    return modifiers.filter((modifier) => members.has(modifier)).length <= max
  })
}

function expandMathModifiers(operand, modifiers) {
  const font = modifiers.find((modifier) => MODIFIER_DEFINITIONS[modifier].className === "font")
  const accent = modifiers.find((modifier) => MODIFIER_DEFINITIONS[modifier].className === "accent")
  let value = operand

  if (font) {
    const fontCommand = font === "bold" && GREEK_OPERAND.test(operand) ? "boldsymbol" : MODIFIER_DEFINITIONS[font].command
    value = `\\${fontCommand}{${value}}`
  }
  if (accent) value = `\\${MODIFIER_DEFINITIONS[accent].command}{${value}}`

  let postfixCount = 0
  for (const modifier of modifiers) {
    const postfix = MODIFIER_DEFINITIONS[modifier].postfix
    if (!postfix) continue
    const wrapped = postfixCount === 0 ? value : `\\left(${value}\\right)`
    value = `${wrapped}${postfix}`
    postfixCount += 1
  }
  return value
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
  const tokenCharacter = /[A-Za-z0-9.@\\{}()^-]/
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
  const tokenCharacter = /[A-Za-z0-9.@\\{}()^-]/
  let start = localCaret
  let end = localCaret
  while (start > 0 && tokenCharacter.test(line.text[start - 1])) start -= 1
  while (end < line.text.length && tokenCharacter.test(line.text[end])) end += 1
  const source = line.text.slice(start, end)
  const parsed = parseMathShorthand(source)
  if (!parsed || !/(?:\.[A-Za-z]+)+$/.test(source)) return null
  return { ...parsed, start: line.from + start, end: line.from + end, source }
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
    const chainPattern = /(?:@[A-Za-z][A-Za-z0-9]*|\\[A-Za-z]+|[A-Za-z])[A-Za-z0-9.@\\{}()^-]*/g
    const changes = []
    for (const match of source.matchAll(chainPattern)) {
      const from = match.index
      const to = from + match[0].length
      const chain = mathShorthandAt(source, to)
      if (chain?.status === "valid" && chain.start === from && chain.expansion !== match[0]) {
        changes.push({ from, to, insert: chain.expansion })
      }
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
