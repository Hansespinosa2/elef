import { syntaxTree } from "@codemirror/language"
import type { EditorState, Extension, Range } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import { livePreviewField } from "./live_preview.js"

interface LezerElement {
  readonly from: number
  readonly to: number
}

interface LezerInlineContext {
  readonly end: number
  char(pos: number): number
  elt(type: string, from: number, to: number, children?: readonly LezerElement[]): LezerElement
  addElement(elt: LezerElement): number
}

interface LezerLine {
  text: string
  readonly pos: number
  readonly depth: number
  moveBase(to: number): void
}

interface LezerBlockContext {
  readonly lineStart: number
  readonly stack: readonly unknown[]
  nextLine(): boolean
  startComposite(type: string, start: number, value: number): void
  elt(type: string, from: number, to: number, children?: readonly LezerElement[]): LezerElement
  addElement(elt: LezerElement): void
}

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13
}

function isEscapedAt(cx: LezerInlineContext, pos: number): boolean {
  let backslashes = 0
  for (let i = pos - 1; i >= 0 && cx.char(i) === 92; i--) {
    backslashes++
  }
  return backslashes % 2 === 1
}

function findInlineDoubleDollarEnd(cx: LezerInlineContext, start: number): number {
  for (let i = start; i < cx.end - 1; i++) {
    const ch = cx.char(i)
    if (ch === 92) {
      i++
      continue
    }
    if (ch === 36 && cx.char(i + 1) === 36) {
      if (i > start) return i
      return -1
    }
  }
  return -1
}

// Tracks the highest position on the current line where no valid single-dollar
// closer exists, preventing O(N^2) rescans on lines with many prose `$` tokens.
const failedSingleDollarUntil = new WeakMap<LezerInlineContext, number>()

function findInlineSingleDollarEnd(cx: LezerInlineContext, start: number): number {
  const failedLimit = failedSingleDollarUntil.get(cx) ?? -1
  if (start <= failedLimit) return -1

  for (let i = start; i < cx.end; i++) {
    const ch = cx.char(i)
    if (ch === 10 || ch === 13) {
      failedSingleDollarUntil.set(cx, i)
      return -1
    }
    if (ch === 92) {
      const escaped = cx.char(i + 1)
      if (escaped === 10 || escaped === 13) {
        failedSingleDollarUntil.set(cx, i + 1)
        return -1
      }
      i++
      continue
    }
    if (ch === 36) {
      if (cx.char(i + 1) === 36) {
        // Skip both `$` of `$$` so the second `$` cannot falsely close an outer `$`.
        i++
        continue
      }
      if (i === start) return -1
      if (isWhitespaceCode(cx.char(i - 1))) continue
      return i
    }
  }
  failedSingleDollarUntil.set(cx, cx.end)
  return -1
}

function isBlockMathFenceLine(text: string, pos: number): boolean {
  if (!text.slice(pos).startsWith("$$")) return false
  return text.slice(pos + 2).trim() === ""
}

export const elefMath = {
  defineNodes: [
    { name: "BlockMath", block: true },
    {
      name: "BlockMathWithProse",
      composite(cx: LezerBlockContext, line: LezerLine, closingLineEnd: number): boolean {
        // Let Lezer recognize setext underlines in continued prose. Dashes
        // immediately after the closing line still form a horizontal rule.
        const content = line.text.slice(line.pos)
        if (/^=+[ \t]*$/.test(content)) return true
        return cx.lineStart > closingLineEnd + 1 && /^-+[ \t]*$/.test(content)
      }
    },
    { name: "InlineMath" },
    { name: "MathMark" },
    { name: "MathMarkBeforeProse" },
    { name: "MathContent" }
  ],
  parseBlock: [
    {
      name: "BlockMath",
      before: "FencedCode",
      endLeaf(_cx: LezerBlockContext, line: LezerLine): boolean {
        return isBlockMathFenceLine(line.text, line.pos)
      },
      parse(cx: LezerBlockContext, line: LezerLine): boolean | null {
        if (!isBlockMathFenceLine(line.text, line.pos)) return false

        const blockDepth = cx.stack.length
        const blockFrom = cx.lineStart + line.pos
        const openEnd = blockFrom + 2
        const children: LezerElement[] = [cx.elt("MathMark", blockFrom, openEnd)]
        const contentFrom = cx.lineStart + line.text.length

        let blockTo = openEnd
        let contentTo = contentFrom
        while (cx.nextLine()) {
          if (line.depth < blockDepth) break
          if (line.text.startsWith("$$", line.pos)) {
            const closeFrom = cx.lineStart + line.pos
            const closeTo = closeFrom + 2
            if (closeFrom > contentFrom) {
              children.push(cx.elt("MathContent", contentFrom, closeFrom))
            }
            if (line.text.slice(line.pos + 2).trim()) {
              // Let the native Markdown parser start a paragraph here. A
              // placeholder for the final dollar keeps block syntax in the
              // suffix inline, while preserving every source offset.
              const paragraphStart = line.pos + 1
              cx.startComposite("BlockMathWithProse", blockFrom - cx.lineStart, cx.lineStart + line.text.length)
              children.push(cx.elt("MathMarkBeforeProse", closeFrom, closeTo - 1))
              cx.addElement(cx.elt("BlockMath", blockFrom, closeTo - 1, children))
              line.text = line.text.slice(0, paragraphStart) + "\uFFFC" + line.text.slice(paragraphStart + 1)
              line.moveBase(paragraphStart)
              return null
            }
            children.push(cx.elt("MathMark", closeFrom, closeTo))
            cx.addElement(cx.elt("BlockMath", blockFrom, cx.lineStart + line.text.length, children))
            cx.nextLine()
            return true
          }
          contentTo = cx.lineStart + line.text.length
          blockTo = contentTo
        }

        if (contentTo > contentFrom) {
          children.push(cx.elt("MathContent", contentFrom, contentTo))
        }

        cx.addElement(cx.elt("BlockMath", blockFrom, blockTo, children))
        return true
      }
    }
  ],
  parseInline: [
    {
      name: "ElefMath",
      parse(cx: LezerInlineContext, next: number, pos: number): number {
        if (next !== 36 || isEscapedAt(cx, pos)) return -1

        const precededByUnescapedDollar = pos > 0 && cx.char(pos - 1) === 36 && !isEscapedAt(cx, pos - 1)

        if (cx.char(pos + 1) === 36) {
          if (precededByUnescapedDollar) return -1
          const closePos = findInlineDoubleDollarEnd(cx, pos + 2)
          if (closePos < 0) return -1
          return cx.addElement(
            cx.elt("InlineMath", pos, closePos + 2, [
              cx.elt("MathMark", pos, pos + 2),
              cx.elt("MathContent", pos + 2, closePos),
              cx.elt("MathMark", closePos, closePos + 2)
            ])
          )
        }

        if (precededByUnescapedDollar) return -1
        const firstAfter = cx.char(pos + 1)
        if (firstAfter < 0 || isWhitespaceCode(firstAfter)) return -1

        const closePos = findInlineSingleDollarEnd(cx, pos + 1)
        if (closePos < 0) return -1

        return cx.addElement(
          cx.elt("InlineMath", pos, closePos + 1, [
            cx.elt("MathMark", pos, pos + 1),
            cx.elt("MathContent", pos + 1, closePos),
            cx.elt("MathMark", closePos, closePos + 1)
          ])
        )
      }
    }
  ]
}

const sourceCodeMarkDecoration = Decoration.mark({ class: "cm-source-code-mark" })
const sourceCodeInfoDecoration = Decoration.mark({ class: "cm-source-code-info" })
const sourceCodeTextDecoration = Decoration.mark({ class: "cm-source-code-text" })
const sourceCodeLineDecoration = Decoration.line({ class: "cm-source-code-line" })
const sourceMathMarkDecoration = Decoration.mark({ class: "cm-source-math-mark" })
const sourceMathContentDecoration = Decoration.mark({ class: "cm-source-math-content" })

export function buildSourceCodeDecorationsFromState(
  state: EditorState,
  ranges: readonly { readonly from: number; readonly to: number }[]
): DecorationSet {
  const livePreview = state.field(livePreviewField, false)
  if (livePreview?.enabled) return Decoration.none

  const decorations: Range<Decoration>[] = []
  const decoratedLines = new Set<number>()
  const decoratedMarks = new Set<string>()
  const tree = syntaxTree(state)

  const addMark = (from: number, to: number, decoration: Decoration, key: string): void => {
    const id = `${from}:${to}:${key}`
    if (decoratedMarks.has(id)) return
    decoratedMarks.add(id)
    decorations.push(decoration.range(from, to))
  }

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === "FencedCode") {
          let child = node.node.firstChild
          while (child) {
            if (child.name === "CodeMark") {
              addMark(child.from, child.to, sourceCodeMarkDecoration, "cm-source-code-mark")
            } else if (child.name === "CodeInfo") {
              addMark(child.from, child.to, sourceCodeInfoDecoration, "cm-source-code-info")
            } else if (child.name === "CodeText") {
              addMark(child.from, child.to, sourceCodeTextDecoration, "cm-source-code-text")
              const clippedStart = Math.max(child.from, from)
              const clippedEnd = Math.min(child.to, to)
              let pos = clippedStart
              while (pos <= clippedEnd) {
                const line = state.doc.lineAt(pos)
                if (!decoratedLines.has(line.from)) {
                  decoratedLines.add(line.from)
                  decorations.push(sourceCodeLineDecoration.range(line.from))
                }
                if (line.to >= clippedEnd || line.to >= state.doc.length) break
                pos = line.to + 1
              }
            }
            child = child.nextSibling
          }
          return false
        }

        if (node.name === "InlineCode") {
          let child = node.node.firstChild
          while (child) {
            if (child.name === "CodeMark") {
              addMark(child.from, child.to, sourceCodeMarkDecoration, "cm-source-code-mark")
            }
            child = child.nextSibling
          }
          return false
        }

        if (node.name === "InlineMath" || node.name === "BlockMath") {
          let child = node.node.firstChild
          while (child) {
            if (child.name === "MathMark" || child.name === "MathMarkBeforeProse") {
              const markEnd = child.name === "MathMarkBeforeProse" ? child.to + 1 : child.to
              addMark(child.from, markEnd, sourceMathMarkDecoration, "cm-source-math-mark")
            } else if (child.name === "MathContent") {
              addMark(child.from, child.to, sourceMathContentDecoration, "cm-source-math-content")
            }
            child = child.nextSibling
          }
          return false
        }
      }
    })
  }

  return Decoration.set(decorations, true)
}

export function buildSourceCodeDecorations(view: EditorView): DecorationSet {
  return buildSourceCodeDecorationsFromState(view.state, view.visibleRanges)
}

export const sourceCodeDecorationsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildSourceCodeDecorations(view)
    }

    update(update: ViewUpdate): void {
      const prevEnabled = update.startState.field(livePreviewField, false)?.enabled
      const nextEnabled = update.state.field(livePreviewField, false)?.enabled
      if (
        update.docChanged ||
        update.viewportChanged ||
        prevEnabled !== nextEnabled ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildSourceCodeDecorations(update.view)
      }
    }
  },
  {
    decorations: (value) => value.decorations
  }
)

export const elefSourceHighlighting: Extension[] = [
  sourceCodeDecorationsPlugin
]
