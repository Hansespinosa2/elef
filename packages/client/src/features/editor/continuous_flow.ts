import { StateEffect, StateField } from "@codemirror/state"
import type { Range, Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import { buildEditorStructure } from "@elef/work-model/document-map"
import { scanMathSource } from "@elef/work-model/math-source"
import { livePreviewField, livePreviewMode, isContinuousPlainTableEdit, localMathEdit, localInlineMathLineEdit, localParagraphEndEdit } from "@elef/client/editor"

export const continuousFlowGeometryChanged = StateEffect.define<void>()

export type BlockMargins = Readonly<Record<string, { before: number; after: number }>>
interface PlainRange { from: number; to: number }
interface FlowDecorations { decorations: DecorationSet; plain: readonly PlainRange[] }

function plainParagraph(text: string): boolean {
  return text.trim().length > 0 && /^[\p{L}\p{N} ,.!?]+$/u.test(text) && !/^\s*\d+[.)]\s/.test(text)
}

function canMapFlow(value: FlowDecorations, transaction: Transaction): boolean {
  if (localMathEdit(transaction) || localInlineMathLineEdit(transaction) || isContinuousPlainTableEdit(transaction)) return true
  let safe = true
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    const range = value.plain.find(item => from >= item.from && to <= item.to)
    const oldLine = transaction.startState.doc.lineAt(from)
    const newLine = transaction.newDoc.lineAt(newFrom)
    // Appending whitespace to the trailing empty line does not create a
    // visible block. Avoid reparsing the whole document for that first key.
    if (!range && from === transaction.startState.doc.length && to === from &&
        !oldLine.text.trim() && !newLine.text.trim() && newTo === transaction.newDoc.length) return
    if (!range || !/^[\p{L}\p{N} ,.!?]*$/u.test(transaction.startState.sliceDoc(from, to) + transaction.newDoc.sliceString(newFrom, newTo))) {
      safe = false; return
    }
    const newStart = transaction.changes.mapPos(range.from, -1)
    const newEnd = transaction.changes.mapPos(range.to, 1)
    if (!plainParagraph(transaction.newDoc.sliceString(newStart, newEnd))) safe = false
  })
  return safe
}

class FlowSpace extends WidgetType {
  constructor(readonly height: number) { super() }
  override eq(other: FlowSpace): boolean { return other.height === this.height }
  override toDOM(): HTMLElement {
    const element = document.createElement("div")
    element.style.height = `${this.height}px`
    element.setAttribute("aria-hidden", "true")
    return element
  }
}

class SoftBreak extends WidgetType {
  override eq(): boolean { return true }
  override toDOM(): HTMLElement {
    const element = document.createElement("span")
    element.textContent = " "
    return element
  }
}

function mapParagraphEnd(value: FlowDecorations, transaction: Transaction, paragraph: PlainRange): FlowDecorations | null {
  const gapStart = paragraph.to + 1
  const removed = new Set<Decoration>()
  const gap: { end: number; widget: Decoration }[] = []
  if (gapStart <= transaction.startState.doc.length) {
    value.decorations.between(gapStart, gapStart, (from, to, decoration) => {
      if (from !== gapStart) return
      if (decoration.spec.class === "cm-continuous-gap") removed.add(decoration)
      if (decoration.spec.widget instanceof FlowSpace) {
        removed.add(decoration)
        gap.push({ end: to, widget: decoration })
      }
    })
  }
  // A gap always consists of both the zero-height line and its space widget.
  // Decline the optimization if the decoration set is not in that shape.
  if ((gap.length && (gap.length !== 1 || removed.size !== 2)) || (!gap.length && removed.size)) return null
  let decorations = value.decorations.map(transaction.changes)
  if (gap[0]) {
    const end = transaction.changes.mapPos(gap[0].end, 1)
    decorations = decorations.update({
      filter: (_from, _to, decoration) => !removed.has(decoration),
      add: [Decoration.line({ class: "cm-continuous-gap" }).range(gapStart), gap[0].widget.range(gapStart, end)],
      sort: true,
    })
  }
  return { decorations, plain: value.plain.map(range => ({
    from: transaction.changes.mapPos(range.from, -1),
    to: transaction.changes.mapPos(range.to, range === paragraph ? -1 : 1),
  })) }
}

// Source lines and reader paragraphs are different units. Keep their source
// positions while presenting soft breaks and collapsed block margins exactly
// as the document renderer does. No DOM-to-Markdown reconciliation occurs.
export function createContinuousFlow(margins: BlockMargins) {
  function build(source: string): FlowDecorations {
    const decorations: Range<Decoration>[] = []
    const plain: PlainRange[] = []
    const blocks = buildEditorStructure(source, { mode: "document" }).editorMap.slides.flatMap(slide => slide.blocks).filter(block => !block.empty_placeholder)
    const math = scanMathSource(source)
    let mathIndex = 0
    let previousAfter = 0
    let previousEnd: number | null = null
    for (const [index, block] of blocks.entries()) {
      const horizontal = block.position?.horizontal
      if (horizontal === "left" || horizontal === "center" || horizontal === "right") {
        // Alignment belongs to the following reader block. Apply it to each
        // editable source line of that block without introducing a separate
        // editing surface or changing its underlying Markdown.
        let lineStart = source.lastIndexOf("\n", block.content_range.start - 1) + 1
        while (lineStart < block.content_range.end) {
          decorations.push(Decoration.line({ class: `cm-continuous-align-${horizontal}` }).range(lineStart))
          const newline = source.indexOf("\n", lineStart)
          if (newline < 0) break
          lineStart = newline + 1
        }
      }
      const heading = block.kind === "heading" ? /^\s*(#{1,6})/.exec(block.markdown)?.[1]?.length : undefined
      const key = heading ? `h${heading}` : block.kind
      const spacing = margins[key] ?? margins["paragraph"] ?? { before: 0, after: 0 }
      const gap = index === 0 ? 0 : Math.max(previousAfter, spacing.before)
      const separator = previousEnd === null ? "" : source.slice(previousEnd, block.source_range.start)
      // Keep one paragraph terminator outside the replacement, so
      // CodeMirror can virtualize individual paragraphs rather than one
      // document-sized visual line. Only the leftover empty source line
      // has zero height; the block widget owns its visible reader margin.
      const ending = /^(?:\r\n|\r|\n)/.exec(separator)?.[0].length ?? 0
      const blankStart = previousEnd === null ? 0 : previousEnd + ending
      if (previousEnd !== null && ending > 0 && blankStart < block.source_range.start && separator.trim() === "") {
        decorations.push(Decoration.line({ class: "cm-continuous-gap" }).range(blankStart))
        decorations.push(Decoration.replace({ widget: new FlowSpace(gap), block: true, inclusive: false }).range(blankStart, block.source_range.start))
      } else if (gap > 0) {
        decorations.push(Decoration.widget({ widget: new FlowSpace(gap), block: true, side: -1 }).range(block.source_range.start))
      }
      previousAfter = spacing.after
      previousEnd = block.content_range.end
      if (block.kind !== "paragraph") continue
      while ((math[mathIndex]?.end ?? Infinity) <= block.content_range.start) mathIndex++
      const span = math[mathIndex]
      const standaloneDisplay = span?.display && span.start >= block.content_range.start && span.end <= block.content_range.end &&
        source.slice(block.content_range.start, span.start).trim() === "" && source.slice(span.end, block.content_range.end).trim() === ""
      if (standaloneDisplay) {
        const lineStart = source.lastIndexOf("\n", block.content_range.start - 1) + 1
        decorations.push(Decoration.line({ class: "cm-continuous-display-math" }).range(lineStart))
      }
      if (plainParagraph(source.slice(block.content_range.start, block.content_range.end))) {
        plain.push({ from: block.content_range.start, to: block.content_range.end })
      }
      let contentMathIndex = mathIndex
      for (let cursor = block.content_range.start; cursor < block.content_range.end; cursor++) {
        if (source[cursor] !== "\n" || source[cursor - 1] === "\\" || source.slice(cursor - 2, cursor) === "  ") continue
        while ((math[contentMathIndex]?.end ?? Infinity) <= cursor) contentMathIndex++
        const currentMath = math[contentMathIndex]
        if (currentMath && cursor >= currentMath.start && cursor < currentMath.end) continue
        decorations.push(Decoration.replace({ widget: new SoftBreak(), inclusive: false }).range(cursor, cursor + 1))
      }
    }
    return { decorations: Decoration.set(decorations, true), plain }
  }
  return StateField.define<{ enabled: boolean } & FlowDecorations>({
    create: state => {
      const enabled = state.field(livePreviewField, false)?.enabled ?? true
      return enabled ? { enabled, ...build(state.doc.toString()) } : { enabled, decorations: Decoration.none, plain: [] }
    },
    update(value, transaction) {
      let enabled = value.enabled
      for (const effect of transaction.effects) if (effect.is(livePreviewMode)) enabled = effect.value
      if (!enabled) return { enabled, decorations: Decoration.none, plain: [] }
      if (enabled !== value.enabled || transaction.effects.some(effect => effect.is(continuousFlowGeometryChanged))) {
        return { enabled, ...build(transaction.newDoc.toString()) }
      }
      if (!transaction.docChanged) return value
      const paragraphEnd = localParagraphEndEdit(transaction)
      const paragraph = paragraphEnd && value.plain.find(range => range.from === paragraphEnd.from && range.to === paragraphEnd.to)
      if (paragraph) {
        const mapped = mapParagraphEnd(value, transaction, paragraph)
        if (mapped) return { enabled, ...mapped }
      }
      if (!canMapFlow(value, transaction)) return { enabled, ...build(transaction.newDoc.toString()) }
      return { enabled, decorations: value.decorations.map(transaction.changes),
        plain: value.plain.map(range => ({ from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) })) }
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  })
}
