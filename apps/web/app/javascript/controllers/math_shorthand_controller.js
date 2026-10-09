import { Controller } from "@hotwired/stimulus"
import { syntaxTree } from "@codemirror/language"
import { editorFor } from "lib/editor_controller_lookup"

const GREEK_OPERAND = /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/
const ATOMIC_MATH_SHORTCUTS = Object.freeze({ "@a": "\\alpha", "@b": "\\beta", "@g": "\\gamma", "@m": "\\mu", "@n": "\\nu", "@q": "\\theta", "@r": "\\rho", "@D": "\\Delta" })
const ATOMIC_LATEX_COMMANDS = new Set(["nabla", "partial", "infty", "ell", "hbar", "Re", "Im", "wp"])
const MATH_ENVIRONMENTS = new Set(["math", "displaymath", "equation", "equation*", "align", "align*", "aligned", "gather", "gather*", "gathered", "multline", "multline*", "split", "cases", "array", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix"])
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
    max: 2,
    modifiers: Object.freeze({
      bar: Object.freeze({ aliases: ["bar"], wrappers: ["bar"], command: "bar" }),
      vector: Object.freeze({ aliases: ["vec", "v"], wrappers: ["vec"], command: "vec" }),
      hat: Object.freeze({ aliases: ["hat"], wrappers: ["hat"], command: "hat" }),
      tilde: Object.freeze({ aliases: ["tilde"], wrappers: ["tilde"], command: "tilde" }),
      dot: Object.freeze({ aliases: ["dot"], wrappers: ["dot"], command: "dot" }),
      ddot: Object.freeze({ aliases: ["ddot"], wrappers: ["ddot"], command: "ddot" })
    })
  }),
  Object.freeze({
    name: "postfix",
    max: 2,
    modifiers: Object.freeze({
      transpose: Object.freeze({ aliases: ["t", "T"], postfix: "^\\top", expanded: ["^\\top", "^{\\mathsf{T}}"] }),
      inverse: Object.freeze({ aliases: ["inv"], postfix: "^{-1}" }),
      dagger: Object.freeze({ aliases: ["dag", "dagger"], postfix: "^\\dagger" }),
      star: Object.freeze({ aliases: ["star"], postfix: "^\\star" }),
      prime: Object.freeze({ aliases: ["prime"], postfix: "'", expanded: ["'", "^\\prime"] })
    })
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
const EXPANDED_MATH_WRAPPERS = new Set(Object.keys(MODIFIER_WRAPPERS))

/** `base` is the innermost atomic operand; recognized wrappers and postfixes are stored in `modifiers`. */
export function parseMathShorthand(token) {
  if (typeof token !== "string") return null

  const split = splitTopLevelModifiers(token)
  const parsedHead = parseExpandedMathHead(split.head)
  if (!parsedHead) return null

  const appendedModifiers = split.names.map((name) => MODIFIER_ALIASES[name] || null)
  if (appendedModifiers.some((modifier) => !modifier)) return null

  const modifiers = collapseRepeatedModifiers([...parsedHead.modifiers, ...appendedModifiers])
  if (modifiers.length === 0 && !parsedHead.nestedChain) return null
  if (!modifiersWithinClassLimits(modifiers) || violatesOperandConstraints(parsedHead, modifiers)) {
    return { status: "invalid", base: parsedHead.base, modifiers }
  }

  return {
    status: "valid",
    base: parsedHead.base,
    modifiers,
    operand: parsedHead.operand,
    scripts: parsedHead.scripts,
    nestedChain: parsedHead.nestedChain,
    expansion: expandMathModifiers(parsedHead.operand, parsedHead.scripts, modifiers)
  }
}

function splitTopLevelModifiers(token) {
  let braceDepth = 0
  let leftDepth = 0
  const dots = []

  for (let index = 0; index < token.length; index += 1) {
    if (token.startsWith("\\left(", index)) {
      leftDepth += 1
      index += "\\left(".length - 1
    } else if (token.startsWith("\\right)", index)) {
      leftDepth = Math.max(0, leftDepth - 1)
      index += "\\right)".length - 1
    } else if (token[index] === "\\") {
      if (/[A-Za-z]/.test(token[index + 1] || "")) {
        index += 1
        while (/[A-Za-z]/.test(token[index + 1] || "")) index += 1
      } else {
        index += 1
      }
    } else if (token[index] === "{") {
      braceDepth += 1
    } else if (token[index] === "}") {
      braceDepth -= 1
      if (braceDepth < 0) return { head: token, names: [""] }
    } else if (token[index] === "." && braceDepth === 0 && leftDepth === 0) {
      dots.push(index)
    }
  }

  if (braceDepth !== 0 || leftDepth !== 0) return { head: token, names: [""] }
  if (dots.length === 0) return { head: token, names: [] }
  return {
    head: token.slice(0, dots[0]),
    names: dots.map((dot, index) => token.slice(dot + 1, dots[index + 1] ?? token.length))
  }
}

function trailingMathPostfix(source) {
  return Object.entries(MODIFIER_DEFINITIONS).find(([, definition]) => (definition.expanded || [definition.postfix]).some((suffix) => suffix && source.endsWith(suffix)))?.[0] || null
}

function parseExpandedMathHead(head) {
  if (!head) return null
  let source = head
  const postfixes = []
  while (source) {
    const postfix = trailingMathPostfix(source)
    if (!postfix) break
    const definition = MODIFIER_DEFINITIONS[postfix]
    const suffix = (definition.expanded || [definition.postfix]).find((candidate) => candidate && source.endsWith(candidate))
    postfixes.push(postfix)
    source = source.slice(0, -suffix.length)
  }
  postfixes.reverse()

  const groupClose = matchingMathLeftGroup(source, 0)
  if (groupClose === source.length) {
    const grouped = parseExpandedMathHead(source.slice("\\left(".length, -"\\right)".length))
    if (!grouped) return null
    return { ...grouped, modifiers: [...grouped.modifiers, ...postfixes] }
  }

  const wrapper = source.match(/^\\([A-Za-z]+)\{/)
  if (wrapper) {
    const wrapperName = wrapper[1]
    if (!EXPANDED_MATH_WRAPPERS.has(wrapperName)) return null
    const open = wrapper[0].length - 1
    const close = matchingMathBrace(source, open)
    if (close < 0) return null
    const innerSource = source.slice(open + 1, close)
    const innerSplit = splitTopLevelModifiers(innerSource)
    let inner
    if (innerSplit.names.length) {
      inner = parseMathShorthand(innerSource)
      if (inner?.status !== "valid") return null
    } else {
      inner = parseExpandedMathHead(innerSource)
    }
    if (!inner) return null

    const tailSource = source.slice(close + 1)
    const tail = parseScripts(tailSource)
    if (!tail || tail.end !== tailSource.length) return null
    return {
      base: inner.base,
      operand: inner.operand,
      scripts: [...(inner.scripts || []), ...tail.scripts],
      modifiers: [...(inner.modifiers || []), MODIFIER_WRAPPERS[wrapperName], ...postfixes],
      nestedChain: inner.nestedChain || tail.nestedChain
    }
  }

  const operandNode = parseMathOperandAt(source, 0)
  if (!operandNode) return null
  const tail = parseScripts(source.slice(operandNode.end))
  if (!tail || tail.end !== source.length - operandNode.end) return null
  return {
    base: operandNode.base,
    operand: operandNode.tex,
    scripts: tail.scripts,
    modifiers: postfixes,
    nestedChain: tail.nestedChain
  }
}

function matchingMathLeftGroup(source, start) {
  if (!source.startsWith("\\left(", start)) return -1
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source.startsWith("\\left(", index)) {
      depth += 1
      index += "\\left(".length - 1
    } else if (source.startsWith("\\right)", index)) {
      depth -= 1
      index += "\\right)".length - 1
      if (depth === 0) return index + 1
      if (depth < 0) return -1
    }
  }
  return -1
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

function collapseRepeatedModifiers(modifiers) {
  const seen = new Set()
  return modifiers.filter((modifier) => {
    const className = MODIFIER_DEFINITIONS[modifier].className
    if (className === "postfix") return true
    const key = className + ":" + modifier
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function violatesOperandConstraints(parsedHead, modifiers) {
  const fonts = modifiers.filter((modifier) => MODIFIER_DEFINITIONS[modifier].className === "font")
  if (fonts.includes("blackboard") && !/^[A-Z]$/.test(parsedHead.base)) return true
  return fonts.length > 0 && ATOMIC_LATEX_COMMANDS.has(parsedHead.base.replace(/^\\/, ""))
}

function expandMathModifiers(operand, scripts, modifiers) {
  const font = modifiers.find((modifier) => MODIFIER_DEFINITIONS[modifier].className === "font")
  const accents = modifiers.filter((modifier) => MODIFIER_DEFINITIONS[modifier].className === "accent")
  let value = operand

  if (font) {
    const fontCommand = font === "bold" && GREEK_OPERAND.test(operand) ? "boldsymbol" : MODIFIER_DEFINITIONS[font].command
    value = "\\" + fontCommand + "{" + value + "}"
  }
  for (const accent of accents) value = "\\" + MODIFIER_DEFINITIONS[accent].command + "{" + value + "}"
  value += scripts.join("")

  let postfixCount = 0
  for (const modifier of modifiers) {
    const postfix = MODIFIER_DEFINITIONS[modifier].postfix
    if (!postfix) continue
    const wrapped = postfixCount === 0 ? value : "\\left(" + value + "\\right)"
    value = wrapped + postfix
    postfixCount += 1
  }
  return value
}

function parseScripts(source) {
  const scripts = []
  let index = 0
  let nestedChain = false
  while (source[index] === "_" || source[index] === "^") {
    const marker = source[index]
    index += 1
    if (source[index] === "{") {
      const close = matchingMathBrace(source, index)
      if (close <= index + 1) return null
      const content = source.slice(index + 1, close)
      const parsed = parseMathShorthand(content)
      if (splitTopLevelModifiers(content).names.length > 0 && parsed?.status !== "valid") return null
      if (parsed?.status === "invalid") return null
      if (parsed?.status === "valid") {
        scripts.push(marker + "{" + parsed.expansion + "}")
        nestedChain = true
      } else {
        scripts.push(marker + source.slice(index, close + 1))
      }
      index = close + 1
      continue
    }

    if (source[index] === "\\") {
      const command = source.slice(index).match(/^\\(?:[A-Za-z]+|.)/)
      if (!command) return null
      scripts.push(marker + command[0])
      index += command[0].length
      continue
    }

    const character = source[index]
    if (!character || /[{}\\_^]/.test(character)) return null
    const length = character.codePointAt(0) > 0xffff ? 2 : 1
    scripts.push(marker + source.slice(index, index + length))
    index += length
  }
  return { scripts, end: index, nestedChain }
}

function parseMathOperandAt(source, start) {
  const character = source[start]
  if (character === "@") {
    const match = source.slice(start).match(/^@[A-Za-z][A-Za-z0-9]*/)
    if (!match || !ATOMIC_MATH_SHORTCUTS[match[0]]) return null
    return { end: start + match[0].length, base: match[0], tex: ATOMIC_MATH_SHORTCUTS[match[0]] }
  }

  if (character === "\\") {
    const match = source.slice(start).match(/^\\([A-Za-z]+)/)
    if (!match) return null
    const command = match[1]
    if (!GREEK_OPERAND.test(match[0]) && !ATOMIC_LATEX_COMMANDS.has(command)) return null
    return { end: start + match[0].length, base: match[0], tex: match[0] }
  }

  if (/[A-Za-z]/.test(character || "")) return { end: start + 1, base: character, tex: character }
  return null
}

export function expandMathShorthand(token) {
  const parsed = parseMathShorthand(token)
  return parsed?.status === "valid" ? parsed.expansion : null
}

export function mathShorthandAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  if (!insideMath(text, caret)) return null
  const tokenCharacter = /[A-Za-z0-9.@\\{}()_^-]/
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
  const tokenCharacter = /[A-Za-z0-9.@\\{}()_^-]/
  let start = localCaret
  let end = localCaret
  while (start > 0 && tokenCharacter.test(line.text[start - 1])) start -= 1
  while (end < line.text.length && tokenCharacter.test(line.text[end])) end += 1
  const source = line.text.slice(start, end)
  const parsed = parseMathShorthand(source)
  const split = splitTopLevelModifiers(source)
  if (!parsed || (split.names.length === 0 && !parsed.nestedChain)) return null
  return { ...parsed, start: line.from + start, end: line.from + end, source }
}

export function mathContextAt(text, caret) {
  if (caret < 0 || caret > text.length) return null
  if (insideCode(text, caret)) return null
  const before = text.slice(0, caret)
  let delimiter = null
  let fence = null
  let inlineCodeLength = null
  const environmentStack = []

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
        if (inlineCodeLength === null) {
          const environment = line.slice(index).match(/^\\(begin|end)\{([^}]+)\}/)
          if (environment && MATH_ENVIRONMENTS.has(environment[2])) {
            if (environment[1] === "begin") environmentStack.push(environment[2])
            else if (environmentStack.at(-1) === environment[2]) environmentStack.pop()
            index += environment[0].length
            continue
          }
        }
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
  if (delimiter === null && environmentStack.length === 0) return null
  if (environmentStack.length > 0 || delimiter === "$$" || delimiter === "\\[") return "display_math"
  return "inline_math"
}

function mathContextMap(text) {
  const contexts = new Uint8Array(text.length + 1)
  let delimiter = null
  let fence = null
  let inlineCodeLength = null
  const environmentStack = []
  let lineStart = 0

  while (lineStart <= text.length) {
    const nextNewline = text.indexOf("\n", lineStart)
    const lineEnd = nextNewline < 0 ? text.length : nextNewline
    const line = text.slice(lineStart, lineEnd)
    const fenceMatch = line.match(/^ {0,3}([\x60~]{3,})(.*)$/)
    let skipLine = false

    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && /^[ \t]*$/.test(fenceMatch[2])) fence = null
      skipLine = true
    } else if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      skipLine = true
    }

    if (skipLine) {
      contexts.fill(0, lineStart, lineEnd + 1)
    } else {
      let index = 0
      while (index < line.length) {
        const absolute = lineStart + index
        const active = inlineCodeLength === null && (delimiter !== null || environmentStack.length > 0) ? 1 : 0
        contexts[absolute] = active

        if (inlineCodeLength === null && line.startsWith("\\(", index)) {
          contexts[absolute + 1] = active
          delimiter = delimiter === "\\)" ? null : delimiter || "\\)"
          index += 2
          continue
        }
        if (inlineCodeLength === null && line.startsWith("\\[", index)) {
          contexts[absolute + 1] = active
          delimiter = delimiter === "\\]" ? null : delimiter || "\\]"
          index += 2
          continue
        }
        if (inlineCodeLength === null && (line.startsWith("\\)", index) || line.startsWith("\\]", index))) {
          contexts[absolute + 1] = active
          const closing = line.slice(index, index + 2)
          if (delimiter === closing) delimiter = null
          index += 2
          continue
        }
        if (line[index] === "\\") {
          if (inlineCodeLength === null) {
            const environment = line.slice(index).match(/^\\(begin|end)\{([^}]+)\}/)
            if (environment && MATH_ENVIRONMENTS.has(environment[2])) {
              if (environment[1] === "begin") environmentStack.push(environment[2])
              else if (environmentStack.at(-1) === environment[2]) environmentStack.pop()
              index += environment[0].length
              continue
            }
          }
          if (index + 1 < line.length) contexts[absolute + 1] = active
          index += 2
          continue
        }
        if (line.charCodeAt(index) === 96) {
          let length = 1
          while (line.charCodeAt(index + length) === 96) length += 1
          for (let offset = 1; offset < length; offset += 1) contexts[absolute + offset] = active
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
          contexts[absolute + 1] = active
          delimiter = delimiter === "$$" ? null : delimiter || "$$"
          index += 2
        } else if (line[index] === "$") {
          delimiter = delimiter === "$" ? null : delimiter || "$"
          index += 1
        } else {
          index += 1
        }
      }
      contexts[lineEnd] = inlineCodeLength === null && (delimiter !== null || environmentStack.length > 0) ? 1 : 0
    }

    if (nextNewline < 0) break
    lineStart = lineEnd + 1
  }

  contexts[text.length] = inlineCodeLength === null && (delimiter !== null || environmentStack.length > 0) ? 1 : 0
  return contexts
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
    const collapsed = editor.selectionStart === editor.selectionEnd

    if (event.key === "Escape" && collapsed) {
      const chain = mathShorthandAtEditor(editor, caret)
      if (chain?.status === "valid") {
        event.preventDefault()
        this.cancelChain(chain)
      }
      return
    }

    if (event.key === "." && collapsed && this.expandAtomicShortcutBeforeDot(editor, caret)) {
      event.preventDefault()
      return
    }

    const plainEnter = event.key === "Enter" && !event.isComposing && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
    if (plainEnter && collapsed) {
      const line = editor.view?.state?.doc.lineAt(caret)
      if (line?.text === "$$$$" && caret - line.from === 2 && editorMathContextAt(editor, caret) === "display_math") {
        event.preventDefault()
        const separator = editor.lineSeparator || "\n"
        editor.replaceRange(separator + separator, caret, caret)
        editor.setSelectionRange(caret + separator.length)
        return
      }
    }

    if (
      event.key === "Backspace" &&
      collapsed &&
      editor.value[caret - 1] === "$" &&
      editor.value[caret] === "$" &&
      !editorInsideCode(editor, caret) &&
      !escapedAt(editor.value, caret - 1)
    ) {
      event.preventDefault()
      editor.replaceRange("", caret - 1, caret + 1)
      editor.setSelectionRange(caret - 1)
      this.pendingChain = mathShorthandAtEditor(editor, caret - 1)
      return
    }

    this.pendingChain = mathShorthandAtEditor(editor, caret)
    const chain = this.pendingChain
    const mathContext = editorMathContextAt(editor, caret)
    if (event.key === "$" && collapsed && chain?.status === "valid" && mathContext) {
      if (caret === chain.end && editor.value[caret] !== "$" && mathContext === "inline_math") {
        event.preventDefault()
        this.commit(chain, "$")
        return
      }
      if (caret === chain.end) {
        this.commit(chain)
      }
    }

    if (event.key === "$" && collapsed) {
      const dollarCaret = editor.selectionStart
      const action = mathDollarActionAtEditor(editor, dollarCaret)
      if (action === "promote") {
        event.preventDefault()
        editor.replaceRange("$$$$", dollarCaret - 1, dollarCaret + 1)
        editor.setSelectionRange(dollarCaret + 1, dollarCaret + 1)
        return
      } else if (action === "skip") {
        event.preventDefault()
        editor.setSelectionRange(dollarCaret + 1, dollarCaret + 1)
        return
      } else if (action === "pair") {
        event.preventDefault()
        editor.replaceRange("$$", dollarCaret, dollarCaret)
        editor.setSelectionRange(dollarCaret + 1, dollarCaret + 1)
        return
      }
    }

    this.pendingChain = mathShorthandAtEditor(editor, editor.selectionStart)
    if (!this.pendingChain || this.pendingChain.status !== "valid" || !collapsed) return

    if (event.key === " " || event.code === "Space" || event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const suffix = event.key === " " || event.code === "Space" ? " " : event.key === "Enter" ? editor.lineSeparator : ""
      this.commit(this.pendingChain, suffix)
      return
    }

    if (["_", "^", "[", "(", "\\"].includes(event.key) || (event.key?.length === 1 && !this.isChainContinuationKey(event.key))) {
      this.commit(this.pendingChain)
    }
  }

  isChainContinuationKey(key) {
    return typeof key === "string" && key.length === 1 && /[A-Za-z.]/.test(key)
  }

  expandAtomicShortcutBeforeDot(editor, caret) {
    if (!editorInsideMath(editor, caret) || editor.selectionStart !== editor.selectionEnd) return false
    const line = editor.view?.state?.doc.lineAt(caret)
    if (!line) return false
    const localCaret = caret - line.from
    const before = line.text.slice(0, localCaret)
    const match = before.match(/(@[A-Za-z][A-Za-z0-9]*)$/)
    if (!match || !ATOMIC_MATH_SHORTCUTS[match[1]]) return false
    const start = localCaret - match[1].length
    if (start > 0 && /[A-Za-z0-9@\\\\]/.test(line.text[start - 1])) return false
    editor.replaceRange(ATOMIC_MATH_SHORTCUTS[match[1]] + ".", line.from + start, caret)
    return true
  }

  cancelChain(chain) {
    const editor = this.editorController
    if (!editor || !chain) return
    const source = editor.value || ""
    this.cancelledChains ||= []
    this.cancelledChains.push({
      source: source.slice(chain.start, chain.end),
      before: source.slice(Math.max(0, chain.start - 32), chain.start),
      after: source.slice(chain.end, chain.end + 32)
    })
    this.pendingChain = null
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
    const chainPattern = /(?:@[A-Za-z][A-Za-z0-9]*|\\[A-Za-z]+|[A-Za-z])[A-Za-z0-9.@\\{}()_^-]*/g
    const matches = [...source.matchAll(chainPattern)]
    const contexts = mathContextMap(source)
    const changes = []

    for (const match of matches) {
      const from = match.index
      const to = from + match[0].length
      if (!contexts[to]) continue
      const chain = parseMathShorthand(match[0])
      if (chain?.status !== "valid") continue
      const split = splitTopLevelModifiers(match[0])
      if (split.names.length === 0 && !chain.nestedChain) continue
      if (chain.expansion === match[0] || this.wasChainCancelled(source, from, to, match[0])) continue
      changes.push({ from, to, insert: chain.expansion })
    }

    if (changes.length) editor.replaceRanges(changes)
  }

  wasChainCancelled(source, from, to, candidate) {
    return (this.cancelledChains || []).some((cancelled) =>
      cancelled.source === candidate &&
      cancelled.before === source.slice(Math.max(0, from - 32), from) &&
      cancelled.after === source.slice(to, to + 32)
    )
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
