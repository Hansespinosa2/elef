import { StateEffect, StateField } from "@codemirror/state"
import { syntaxTree } from "@codemirror/language"
import { Decoration, EditorView, WidgetType } from "@codemirror/view"

export const livePreviewMode = StateEffect.define()

class PreviewWidget extends WidgetType {
  constructor(kind, value, attributes = {}) {
    super()
    this.kind = kind
    this.value = value
    this.attributes = attributes
  }

  eq(other) {
    return other.kind === this.kind && other.value === this.value && JSON.stringify(other.attributes) === JSON.stringify(this.attributes)
  }

  toDOM() {
    if (this.kind === "rule") {
      const rule = document.createElement("hr")
      rule.className = "cm-live-rule"
      return rule
    }

    if (this.kind === "image") {
      const image = document.createElement("img")
      image.className = "cm-live-image"
      image.alt = this.attributes.alt || ""
      image.src = this.attributes.src || ""
      image.title = this.attributes.alt || ""
      return image
    }

    if (this.kind === "syntax") {
      const marker = document.createElement("span")
      marker.className = "cm-live-syntax-marker"
      marker.textContent = this.value
      marker.setAttribute("aria-hidden", "true")
      return marker
    }

    const element = document.createElement("span")
    element.className = `cm-live-widget cm-live-widget-${this.kind}${this.kind === "quote-marker" ? " cm-live-syntax-marker" : ""}`
    element.textContent = this.value
    return element
  }

  ignoreEvent() {
    return false
  }
}

const replaceDecoration = (widget = null) => Decoration.replace({ widget, inclusive: false })
const markDecoration = (className) => Decoration.mark({ class: className })
const lineDecoration = (className) => Decoration.line({ class: className })

function activeRange(state, from, to) {
  return state.selection.ranges.some((range) => {
    const cursor = range.from === range.to
      ? range.from >= from && range.from <= to
      : range.from < to && range.to > from
    return cursor
  })
}

function safeUrl(url) {
  return /^(?:https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i.test(url)
}

function addHidden(decorations, state, from, to, widget = null, context = null) {
  if (from >= to) return
  const [activeFrom, activeTo] = context || [from, to]
  if (activeRange(state, activeFrom, activeTo)) {
    decorations.push(markDecoration("cm-live-active-syntax").range(from, to))
    return
  }
  decorations.push(markDecoration("cm-live-syntax-marker").range(from, to))
  decorations.push(replaceDecoration(widget || new PreviewWidget("syntax", state.sliceDoc(from, to))).range(from, to))
}

function addMark(decorations, state, from, to, className) {
  if (from >= to) return
  decorations.push(markDecoration(className).range(from, to))
}

function addInlineMarkup(decorations, state, source) {
  // Images are widgets only when their destination is safe. Unknown or
  // malformed media stays as editable Markdown instead of disappearing.
  const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g
  for (const match of source.matchAll(imagePattern)) {
    const from = match.index
    const to = from + match[0].length
    if (safeUrl(match[2])) addHidden(decorations, state, from, to, new PreviewWidget("image", "", { alt: match[1], src: match[2] }), [from, to])
  }

  const linkPattern = /\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g
  for (const match of source.matchAll(linkPattern)) {
    const from = match.index
    const labelStart = from + 1
    const labelEnd = labelStart + match[1].length
    const destinationStart = labelEnd + 2
    const destinationEnd = from + match[0].length
    if (!safeUrl(match[2])) continue
    addHidden(decorations, state, from, labelStart, null, [from, destinationEnd])
    addHidden(decorations, state, labelEnd, destinationEnd, null, [from, destinationEnd])
    addMark(decorations, state, labelStart, labelEnd, "cm-live-link")
  }

  const documentLinkPattern = /\[\[([^\]\r\n]+)\]\]/g
  for (const match of source.matchAll(documentLinkPattern)) {
    const from = match.index
    const labelStart = from + 2
    const labelEnd = labelStart + match[1].length
    addHidden(decorations, state, from, labelStart, null, [from, from + match[0].length])
    addHidden(decorations, state, labelEnd, from + match[0].length, null, [from, from + match[0].length])
    addMark(decorations, state, labelStart, labelEnd, "cm-live-document-link")
  }

  const mathPattern = /\$\$(.+?)\$\$|(?<!\$)\$(?!\s)(.+?)(?<!\s)\$(?!\$)/gs
  for (const match of source.matchAll(mathPattern)) {
    const expression = match[1] || match[2]
    const from = match.index
    const to = from + match[0].length
    const widget = new PreviewWidget(match[1] ? "math-display" : "math", expression.trim())
    addHidden(decorations, state, from, to, widget, [from, to])
  }

  const codePattern = /(`+)([^`\r\n]+?)\1/g
  for (const match of source.matchAll(codePattern)) {
    const from = match.index
    const contentStart = from + match[1].length
    const contentEnd = contentStart + match[2].length
    addHidden(decorations, state, from, contentStart, null, [from, from + match[0].length])
    addHidden(decorations, state, contentEnd, from + match[0].length, null, [from, from + match[0].length])
    addMark(decorations, state, contentStart, contentEnd, "cm-live-inline-code")
  }

  const strongPattern = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g
  for (const match of source.matchAll(strongPattern)) {
    const from = match.index
    const contentStart = from + match[1].length
    const contentEnd = contentStart + match[2].length
    addHidden(decorations, state, from, contentStart, null, [from, from + match[0].length])
    addHidden(decorations, state, contentEnd, from + match[0].length, null, [from, from + match[0].length])
    addMark(decorations, state, contentStart, contentEnd, "cm-live-strong")
  }

  const emphasisPattern = /(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<!_)_(?!\s)(.+?)(?<!\s)_(?!_)/g
  for (const match of source.matchAll(emphasisPattern)) {
    const marker = match[0][0]
    const text = match[1] || match[2]
    const from = match.index
    const contentStart = from + 1
    const contentEnd = contentStart + text.length
    addHidden(decorations, state, from, contentStart, null, [from, from + match[0].length])
    addHidden(decorations, state, contentEnd, from + match[0].length, null, [from, from + match[0].length])
    addMark(decorations, state, contentStart, contentEnd, "cm-live-emphasis")
    void marker
  }
}

function addBlockMarkup(decorations, state, source) {
  const lines = source.split("\n")
  let offset = 0
  let fence = null

  lines.forEach((line, index) => {
    const lineStart = offset
    const lineEnd = lineStart + line.length
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/)
    if (fenceMatch) {
      if (!fence) {
        fence = { marker: fenceMatch[2][0], length: fenceMatch[2].length }
        addHidden(
          decorations,
          state,
          lineStart + fenceMatch[1].length,
          lineStart + fenceMatch[1].length + fenceMatch[2].length,
          null,
          [lineStart, lineEnd]
        )
        if (fenceMatch[3].trim()) addHidden(decorations, state, lineStart + line.length - fenceMatch[3].length, lineEnd, null, [lineStart, lineEnd])
        decorations.push(lineDecoration("cm-live-code-fence").range(lineStart))
      } else if (fence.marker === fenceMatch[2][0] && fenceMatch[2].length >= fence.length && fenceMatch[3].trim() === "") {
        addHidden(decorations, state, lineStart + fenceMatch[1].length, lineStart + line.length, null, [lineStart, lineEnd])
        decorations.push(lineDecoration("cm-live-code-fence").range(lineStart))
        fence = null
      }
      offset = lineEnd + 1
      return
    }

    if (fence) {
      decorations.push(lineDecoration("cm-live-code-line").range(lineStart))
      offset = lineEnd + 1
      return
    }

    const heading = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/)
    if (heading) {
      const markerStart = lineStart + heading[1].length
      addMark(
        decorations,
        state,
        markerStart,
        markerStart + heading[2].length,
        activeRange(state, lineStart, lineEnd) ? "cm-live-active-syntax" : "cm-live-syntax-marker"
      )
      addHidden(decorations, state, markerStart, markerStart + heading[2].length + heading[3].length, null, [lineStart, lineEnd])
      const headingTextStart = markerStart + heading[2].length + heading[3].length
      decorations.push(lineDecoration(`cm-live-heading cm-live-heading-${heading[2].length}`).range(lineStart))
      addMark(decorations, state, headingTextStart, lineEnd, `cm-live-heading-text cm-live-heading-text-${heading[2].length}`)
      offset = lineEnd + 1
      return
    }

    const list = line.match(/^(\s*)([-+*]|\d+[.)])(\s+)/)
    if (list) {
      const markerStart = lineStart + list[1].length
      addHidden(
        decorations,
        state,
        markerStart,
        markerStart + list[2].length + list[3].length,
        new PreviewWidget("list-marker", list[2].match(/\d/) ? "1." : "•"),
        [lineStart, lineEnd]
      )
      decorations.push(lineDecoration("cm-live-list-item").range(lineStart))
    }

    const quote = line.match(/^(\s*>\s?)/)
    if (quote) {
      const markerStart = lineStart + quote[1].indexOf(">")
      addMark(
        decorations,
        state,
        markerStart,
        markerStart + 1,
        activeRange(state, lineStart, lineEnd) ? "cm-live-active-syntax" : "cm-live-syntax-marker"
      )
      addHidden(decorations, state, markerStart, markerStart + 1, new PreviewWidget("quote-marker", ">"), [lineStart, lineEnd])
      decorations.push(lineDecoration("cm-live-quote").range(lineStart))
    }

    if (line.match(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/)) {
      addHidden(decorations, state, lineStart, lineEnd, new PreviewWidget("rule", ""), [lineStart, lineEnd])
    }

    if (index < lines.length - 1) offset = lineEnd + 1
  })
}

function addSyntaxTreeHints(decorations, state) {
  // The Markdown parser is the authority for fenced regions and inline node
  // boundaries. Regex projections above are intentionally conservative; this
  // traversal adds the same styling to parser-recognized nodes without
  // hiding unknown syntax.
  const tree = syntaxTree(state)
  tree.iterate({
    enter(node) {
      if (node.name === "Blockquote") {
        decorations.push(lineDecoration("cm-live-quote").range(node.from))
      } else if (node.name === "ElefMetadata") {
        addMark(
          decorations,
          state,
          node.from,
          node.to,
          activeRange(state, node.from, node.to) ? "cm-live-active-syntax" : "cm-live-syntax-marker"
        )
      }
    }
  })
}

function buildDecorations(state, enabled) {
  if (!enabled) return { decorations: Decoration.none, atomic: Decoration.none, error: null }

  try {
    const source = state.doc.toString()
    const decorations = []
    addBlockMarkup(decorations, state, source)
    addInlineMarkup(decorations, state, source)
    addSyntaxTreeHints(decorations, state)
    const set = Decoration.set(decorations, true)
    const atomic = Decoration.set(decorations.filter((range) => range.value.spec.widget), true)
    return { decorations: set, atomic, error: null }
  } catch (error) {
    return {
      decorations: Decoration.none,
      atomic: Decoration.none,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export const livePreviewField = StateField.define({
  create(state) {
    return { enabled: true, ...buildDecorations(state, true) }
  },
  update(value, transaction) {
    let enabled = value.enabled
    for (const effect of transaction.effects) {
      if (effect.is(livePreviewMode)) enabled = Boolean(effect.value)
    }
    if (transaction.docChanged || transaction.selection || enabled !== value.enabled) {
      return { enabled, ...buildDecorations(transaction.state, enabled) }
    }
    return value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic)
  ]
})
