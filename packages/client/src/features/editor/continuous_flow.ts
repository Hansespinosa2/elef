import { StateField } from "@codemirror/state"
import type { Range } from "@codemirror/state"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"
import type { DecorationSet } from "@codemirror/view"
import { buildEditorStructure } from "@elef/work-model/document-map"
import { scanMathSource } from "@elef/work-model/math-source"
import { livePreviewMode } from "@elef/client/editor"

export type BlockMargins = Readonly<Record<string, { before: number; after: number }>>

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
  function build(source: string): DecorationSet {
    const decorations: Range<Decoration>[] = []
    const blocks = buildEditorStructure(source, { mode: "document" }).editorMap.slides.flatMap(slide => slide.blocks).filter(block => !block.empty_placeholder)
    const math = scanMathSource(source)
    let previousAfter = 0
    let previousEnd: number | null = null
    for (const [index, block] of blocks.entries()) {
      const heading = block.kind === "heading" ? /^\s*(#{1,6})/.exec(block.markdown)?.[1]?.length : undefined
      const key = heading ? `h${heading}` : block.kind
      const spacing = margins[key] ?? margins["paragraph"] ?? { before: 0, after: 0 }
      const gap = index === 0 ? 0 : Math.max(previousAfter, spacing.before)
      if (previousEnd !== null && previousEnd < block.source_range.start && source.slice(previousEnd, block.source_range.start).trim() === "") {
        decorations.push(Decoration.replace({ block: true, inclusive: false }).range(previousEnd, block.source_range.start))
      }
      if (gap > 0) decorations.push(Decoration.widget({ widget: new FlowSpace(gap), block: true, side: -1 }).range(block.source_range.start))
      previousAfter = spacing.after
      previousEnd = block.content_range.end
      if (block.kind !== "paragraph") continue
      for (let cursor = block.content_range.start; cursor < block.content_range.end; cursor++) {
        if (source[cursor] !== "\n" || source[cursor - 1] === "\\" || source.slice(cursor - 2, cursor) === "  ") continue
        if (math.some(span => cursor >= span.start && cursor < span.end)) continue
        decorations.push(Decoration.replace({ widget: new SoftBreak(), inclusive: false }).range(cursor, cursor + 1))
      }
    }
    return Decoration.set(decorations, true)
  }
  return StateField.define<{ enabled: boolean; decorations: DecorationSet }>({
    create: state => ({ enabled: true, decorations: build(state.doc.toString()) }),
    update(value, transaction) {
      let enabled = value.enabled
      for (const effect of transaction.effects) if (effect.is(livePreviewMode)) enabled = effect.value
      if (!enabled) return { enabled, decorations: Decoration.none }
      return transaction.docChanged || enabled !== value.enabled
        ? { enabled, decorations: build(transaction.newDoc.toString()) } : value
    },
    provide: field => EditorView.decorations.from(field, value => value.decorations),
  })
}
