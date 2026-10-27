import { StateEffect, StateField } from "@codemirror/state"
import type { Range, Transaction } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import { buildEditorStructure } from "@elef/work-model/document-map"
import { scanMathSource } from "@elef/work-model/math-source"
import { livePreviewField, livePreviewMode } from "@elef/client/editor"

export const continuousFlowGeometryChanged = StateEffect.define<void>()

export type BlockMargins = Readonly<Record<string, { before: number; after: number }>>
interface PlainRange { from: number; to: number }
interface FlowDecorations { decorations: DecorationSet; plain: readonly PlainRange[] }

function plainParagraph(text: string): boolean {
  return text.trim().length > 0 && /^[\p{L}\p{N} ,.!?]+$/u.test(text) && !/^\s*\d+[.)]\s/.test(text)
}

function canMapFlow(value: FlowDecorations, transaction: Transaction): boolean {
  let safe = true
  transaction.changes.iterChangedRanges((from, to, newFrom, newTo) => {
    const range = value.plain.find(item => from >= item.from && to <= item.to)
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

// Source lines and reader paragraphs are different units. Keep their source
// positions while presenting soft breaks and collapsed block margins exactly
// as the document renderer does. No DOM-to-Markdown reconciliation occurs.
export function createContinuousFlow(margins: BlockMargins) {
  function build(source: string): FlowDecorations {
    const decorations: Range<Decoration>[] = []
    const plain: PlainRange[] = []
    const blocks = buildEditorStructure(source, { mode: "document" }).editorMap.slides.flatMap(slide => slide.blocks).filter(block => !block.empty_placeholder)
    const math = scanMathSource(source)
    let previousAfter = 0
    let previousEnd: number | null = null
    for (const [index, block] of blocks.entries()) {
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
      if (plainParagraph(source.slice(block.content_range.start, block.content_range.end))) {
        plain.push({ from: block.content_range.start, to: block.content_range.end })
      }
      for (let cursor = block.content_range.start; cursor < block.content_range.end; cursor++) {
        if (source[cursor] !== "\n" || source[cursor - 1] === "\\" || source.slice(cursor - 2, cursor) === "  ") continue
        if (math.some(span => cursor >= span.start && cursor < span.end)) continue
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
      if (!canMapFlow(value, transaction)) return { enabled, ...build(transaction.newDoc.toString()) }
      return { enabled, decorations: value.decorations.map(transaction.changes),
        plain: value.plain.map(range => ({ from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1) })) }
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  })
}
