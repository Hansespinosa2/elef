import { Controller } from "@hotwired/stimulus"
import { editorFor } from "controllers/editor_controller"

const MODIFIER_ORDER = ["accent", "style", "postfix"]
// One modifier per group is allowed. The fixed group order canonicalizes all permutations.
const MODIFIER_ALIASES = {
  bar: "bar",
  hat: "hat",
  h: "hat",
  tilde: "tilde",
  t: "tilde",
  vec: "vec",
  vector: "vec",
  dot: "dot",
  ddot: "ddot",
  check: "check",
  underline: "underline",
  overline: "overline",
  b: "bold",
  bb: "bold",
  bold: "bold",
  blackboard: "blackboard",
  T: "transpose",
  tr: "transpose",
  transpose: "transpose"
}
const MODIFIERS = {
  bar: { group: "accent", apply: (value) => `\\bar{${value}}` },
  hat: { group: "accent", apply: (value) => `\\hat{${value}}` },
  tilde: { group: "accent", apply: (value) => `\\tilde{${value}}` },
  vec: { group: "accent", apply: (value) => `\\vec{${value}}` },
  dot: { group: "accent", apply: (value) => `\\dot{${value}}` },
  ddot: { group: "accent", apply: (value) => `\\ddot{${value}}` },
  check: { group: "accent", apply: (value) => `\\check{${value}}` },
  underline: { group: "accent", apply: (value) => `\\underline{${value}}` },
  overline: { group: "accent", apply: (value) => `\\overline{${value}}` },
  bold: { group: "style", apply: (value) => `\\mathbf{${value}}` },
  blackboard: { group: "style", apply: (value) => `\\mathbb{${value}}` },
  transpose: { group: "postfix", apply: (value) => `${value}^{\\mathsf{T}}` }
}

function normalizedModifiers(names) {
  const modifiers = names.map((name) => Object.hasOwn(MODIFIER_ALIASES, name) ? MODIFIER_ALIASES[name] : null)
  if (modifiers.some((modifier) => !modifier)) return null

  const groups = new Set()
  for (const modifier of modifiers) {
    if (!Object.hasOwn(MODIFIERS, modifier)) return null
    const group = MODIFIERS[modifier].group
    if (groups.has(group)) return { status: "unsupported", modifiers }
    groups.add(group)
  }

  return { status: "valid", modifiers }
}

export function parseMathShorthand(token) {
  const match = token.match(/^([A-Za-z][A-Za-z0-9]*)(?:\.([A-Za-z][A-Za-z0-9]*))+$/)
  if (!match) return null

  const [base, ...names] = token.split(".")
  const parsedModifiers = normalizedModifiers(names)
  if (!parsedModifiers) return null
  if (parsedModifiers.status === "unsupported") return { status: "unsupported", base, modifiers: parsedModifiers.modifiers }

  const expansion = MODIFIER_ORDER.reduce((value, group) => {
    const modifier = parsedModifiers.modifiers.find((candidate) => MODIFIERS[candidate].group === group)
    return modifier ? MODIFIERS[modifier].apply(value) : value
  }, base)

  return { status: "valid", base, modifiers: parsedModifiers.modifiers, expansion }
}

export function expandMathShorthand(token) {
  const parsed = parseMathShorthand(token)
  return parsed?.status === "valid" ? parsed.expansion : null
}

export function insideMath(text, caret) {
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

  connect() {
    this.lastExpansion = null
    this.editorController = editorFor(this.element)
    this.editorReady = () => { this.editorController ||= editorFor(this.element); this.setupEditor() }
    this.element.addEventListener("elef:editor-ready", this.editorReady)
    this.setupEditor()
  }

  disconnect() {
    if (this.editorController && this.keydownBound) this.editorController.dom.removeEventListener("keydown", this.handleEditorKeydown, true)
    this.element.removeEventListener("elef:editor-ready", this.editorReady)
  }

  setupEditor() {
    this.editorController ||= editorFor(this.element)
    if (this.editorController && !this.keydownBound) {
      this.handleEditorKeydown = (event) => this.keydown(event)
      this.editorController.dom.addEventListener("keydown", this.handleEditorKeydown, true)
      this.keydownBound = true
    }
  }

  keydown(event) {
    if (event.defaultPrevented || event.elefMathShorthandHandled) return
    if (!["Enter", "Tab"].includes(event.key)) return

    const editor = this.editorController
    if (!editor || !editor.insertMode) return
    if (editor.selectionStart !== editor.selectionEnd) return
    const caret = editor.selectionStart
    if (!insideMath(editor.value, caret)) return

    const appended = this.expandAppendedModifiers(editor, caret)
    if (appended) {
      if (appended.status === "valid") {
        event.preventDefault()
        editor.replaceRange(appended.expansion, appended.start, caret)
        this.lastExpansion = {
          start: appended.start,
          end: appended.start + appended.expansion.length,
          base: appended.base,
          modifiers: appended.modifiers,
          expansion: appended.expansion
        }
      } else if (appended.status === "unsupported") {
        event.elefMathShorthandHandled = true
        this.lastExpansion = null
      }
      return
    }

    const before = editor.value.slice(0, caret)
    const match = before.match(/([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)$/)
    if (!match) return

    const parsed = parseMathShorthand(match[1])
    if (parsed?.status === "unsupported") {
      event.elefMathShorthandHandled = true
      this.lastExpansion = null
      return
    }
    if (parsed?.status !== "valid") return

    event.preventDefault()
    const start = caret - match[1].length
    editor.replaceRange(parsed.expansion, start, caret)
    this.lastExpansion = {
      start,
      end: start + parsed.expansion.length,
      base: parsed.base,
      modifiers: parsed.modifiers,
      expansion: parsed.expansion
    }
  }

  expandAppendedModifiers(editor, caret) {
    const previous = this.lastExpansion
    if (!previous || caret < previous.end) return null
    if (editor.value.slice(previous.start, previous.end) !== previous.expansion) {
      this.lastExpansion = null
      return null
    }

    const suffix = editor.value.slice(previous.end, caret)
    if (!/^(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(suffix)) return null

    const token = [previous.base, ...previous.modifiers, ...suffix.slice(1).split(".")].join(".")
    const parsed = parseMathShorthand(token)
    if (!parsed) return null
    if (parsed.status === "unsupported") return { ...parsed, start: previous.start }

    return { ...parsed, start: previous.start }
  }
}
