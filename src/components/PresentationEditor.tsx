import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import katex from 'katex';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {
  deleteSlideMarkdown,
  insertSlideMarkdown,
  isSlideOverBudget,
  parseMarkdown,
  setSlideLayout,
  slideSourceRanges,
  splitSlideMarkdown,
} from '../domain/presentation';
import type { Presentation, SlideLayout, SlideSourceRange, ThemeMode } from '../domain/presentation';
import './PresentationPreview.css';
import 'katex/dist/katex.min.css';

interface Props {
  presentation: Presentation;
  theme: ThemeMode;
  source: string;
  onSourceChange: (source: string) => void;
}

interface MathRange {
  from: number;
  to: number;
  source: string;
  display: boolean;
  valid: boolean;
}

export interface MarkdownBlockRange {
  from: number;
  to: number;
  slideIndex: number;
  markdown: string;
}

interface SplitPreview {
  original: string;
  proposed: string;
  slideIndex: number;
}

interface SourceRevealRange {
  from: number;
  to: number;
}

function findMathRanges(source: string): MathRange[] {
  const ranges: MathRange[] = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('$', index);
    if (start < 0 || source[start - 1] === '\\') break;
    const display = source[start + 1] === '$';
    const delimiter = display ? '$$' : '$';
    const contentStart = start + delimiter.length;
    let end = contentStart;
    while (end < source.length) {
      const candidate = source.indexOf(delimiter, end);
      if (candidate < 0) {
        ranges.push({ from: start, to: source.length, source: source.slice(contentStart), display, valid: false });
        index = source.length;
        break;
      }
      if (source[candidate - 1] !== '\\' && (display || !/\s/.test(source.slice(contentStart, candidate)))) {
        const value = source.slice(contentStart, candidate);
        let valid = true;
        try {
          katex.renderToString(value, { displayMode: display, throwOnError: true });
        } catch {
          valid = false;
        }
        ranges.push({ from: start, to: candidate + delimiter.length, source: value, display, valid });
        index = candidate + delimiter.length;
        break;
      }
      end = candidate + delimiter.length;
    }
    if (end >= source.length && index <= start) {
      ranges.push({ from: start, to: source.length, source: source.slice(contentStart), display, valid: false });
      index = source.length;
    }
  }
  return ranges;
}

function lineOffsets(source: string, start: number, end: number): Array<{ from: number; to: number; text: string }> {
  const lines: Array<{ from: number; to: number; text: string }> = [];
  let from = start;
  while (from <= end) {
    const newline = source.indexOf('\n', from);
    const to = newline < 0 || newline >= end ? end : newline;
    lines.push({ from, to, text: source.slice(from, to).replace(/\r$/, '') });
    if (newline < 0 || newline >= end) break;
    from = newline + 1;
  }
  return lines;
}

/**
 * Produces source-backed Markdown blocks without interpreting or rewriting them.
 * Blank lines separate prose, while fences and adjacent list/table/quote lines
 * stay together so revealing a block exposes the useful editing unit.
 */
export function markdownBlockRanges(source: string): MarkdownBlockRange[] {
  const blocks: MarkdownBlockRange[] = [];
  for (const slide of slideSourceRanges(source)) {
    const lines = lineOffsets(source, slide.start, slide.end);
    let start: number | null = null;
    let end = slide.start;
    let fence: { marker: string; length: number } | null = null;

    const flush = () => {
      if (start === null) return;
      blocks.push({
        from: start,
        to: end,
        slideIndex: slide.index,
        markdown: source.slice(start, end),
      });
      start = null;
    };

    for (const line of lines) {
      const trimmed = line.text.trim();
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
      const heading = !fence && /^#{1,6}\s+/.test(trimmed);
      if (!fence && !trimmed) {
        flush();
        continue;
      }
      if (!fence && start === null && /^:{3}slide-layout\{[^}\s]+\}[ \t]*$/.test(trimmed)) {
        continue;
      }
      if (heading && start !== null) flush();
      if (start === null) start = line.from;
      end = line.to;
      if (fenceMatch) {
        const next = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        fence = fence && fence.marker === next.marker && next.length >= fence.length ? null : next;
      }
      if (heading || (fenceMatch && !fence)) flush();
    }
    flush();
  }
  return blocks.filter((block) => block.to > block.from);
}

function renderedMarkdown(markdownSource: string): string {
  const content = markdownSource.replace(/^\s{0,3}:::slide-layout\{[^}\s]+\}[ \t]*(?:\r?\n|$)/, '');
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
    >
      {content || '\u00a0'}
    </ReactMarkdown>,
  );
}

function annotateRenderedMath(element: HTMLElement, block: MarkdownBlockRange): void {
  const math = findMathRanges(block.markdown);
  element.querySelectorAll<HTMLElement>('.katex').forEach((node, index) => {
    const range = math[index];
    if (!range) return;
    node.dataset.mathFrom = String(block.from + range.from);
    node.dataset.mathTo = String(block.from + range.to);
    node.title = range.valid ? 'Click to edit TeX; double-click to select it' : 'Invalid TeX — source retained';
  });
}

class RenderedBlockWidget extends WidgetType {
  constructor(
    private readonly block: MarkdownBlockRange,
    private readonly layout: SlideLayout,
    private readonly firstInSlide: boolean,
    private readonly lastInSlide: boolean,
    private readonly sourceFragment = false,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = [
      'cm-rendered-block',
      'slide-preview-block',
      `cm-slide-${this.layout}`,
      this.sourceFragment ? 'cm-rendered-fragment' : '',
      this.firstInSlide ? 'cm-slide-first' : '',
      this.lastInSlide ? 'cm-slide-last' : '',
    ].filter(Boolean).join(' ');
    element.dataset.blockFrom = String(this.block.from);
    element.dataset.blockTo = String(this.block.to);
    element.dataset.slideIndex = String(this.block.slideIndex);
    element.dataset.slideSurface = String(this.block.slideIndex);
    if (this.firstInSlide) {
      element.dataset.slideLabel = `Slide ${this.block.slideIndex + 1}`;
      element.dataset.slideLayout = this.layout;
    }
    element.innerHTML = renderedMarkdown(this.block.markdown);
    element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox, index) => {
      const taskLines = lineOffsets(this.block.markdown, 0, this.block.markdown.length)
        .filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line.text));
      const line = taskLines[index];
      if (!line) return;
      const marker = line.text.search(/\[[ xX]\]/);
      checkbox.disabled = false;
      checkbox.dataset.taskFrom = String(this.block.from + line.from + marker);
    });
    annotateRenderedMath(element, this.block);
    if (findMathRanges(this.block.markdown).some((range) => !range.valid)) {
      element.classList.add('slide-invalid-tex');
      const warning = document.createElement('small');
      warning.className = 'cm-invalid-tex-warning';
      warning.textContent = 'TeX is incomplete or invalid. Click to edit the preserved source.';
      element.append(warning);
    }
    return element;
  }

  eq(other: WidgetType): boolean {
    return other instanceof RenderedBlockWidget
      && other.block.from === this.block.from
      && other.block.to === this.block.to
      && other.block.markdown === this.block.markdown
      && other.layout === this.layout
      && other.firstInSlide === this.firstInSlide
      && other.lastInSlide === this.lastInSlide
      && other.sourceFragment === this.sourceFragment;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class MathWidget extends WidgetType {
  constructor(private readonly range: MathRange) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.range.display ? 'div' : 'span');
    element.className = `cm-math-widget${this.range.valid ? '' : ' cm-math-invalid'}`;
    element.dataset.mathSource = this.range.source;
    element.dataset.mathFrom = String(this.range.from);
    element.dataset.mathTo = String(this.range.to);
    element.title = this.range.valid ? 'Click to edit TeX; double-click to select it' : 'Invalid TeX — source retained';
    if (this.range.valid) {
      element.innerHTML = katex.renderToString(this.range.source, {
        displayMode: this.range.display,
        throwOnError: false,
      });
    } else {
      element.textContent = this.range.source;
    }
    return element;
  }

  eq(other: WidgetType): boolean {
    return other instanceof MathWidget
      && other.range.source === this.range.source
      && other.range.display === this.range.display
      && other.range.valid === this.range.valid;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class SlideBoundaryWidget extends WidgetType {
  constructor(
    private readonly slideIndex: number,
    private readonly layout: SlideLayout,
    private readonly overBudget: boolean,
    private readonly canSplit: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = `cm-slide-boundary${this.overBudget ? ' may-overflow' : ''}`;
    element.dataset.slideIndex = String(this.slideIndex);
    element.innerHTML = `
      <div class="cm-slide-page-fill" aria-hidden="true"></div>
      <div class="cm-slide-overflow-warning" role="status">Slide may overflow its 16:9 page.</div>
      <div class="slide-boundary" role="group" aria-label="Actions for slide ${this.slideIndex + 1}">
        <span class="slide-boundary-label">Slide ${this.slideIndex + 1}</span>
        <div class="slide-boundary-actions">
          <button class="slide-delete-button" type="button" data-slide-action="delete" aria-label="Delete slide ${this.slideIndex + 1}">−</button>
          ${this.canSplit ? `<button class="slide-split-button" type="button" data-slide-action="preview-split" aria-label="Preview automatic split for slide ${this.slideIndex + 1}">Preview split</button>` : ''}
          <label class="slide-layout-control">
            <span class="sr-only">Layout for slide ${this.slideIndex + 1}</span>
            <select data-slide-action="layout" aria-label="Layout for slide ${this.slideIndex + 1}">
              <option value="body" ${this.layout === 'body' ? 'selected' : ''}>Body</option>
              <option value="intro" ${this.layout === 'intro' ? 'selected' : ''}>Intro</option>
            </select>
          </label>
          <button class="slide-add-button" type="button" data-slide-action="add" aria-label="Add slide after slide ${this.slideIndex + 1}">+</button>
        </div>
      </div>
    `;
    return element;
  }

  eq(other: WidgetType): boolean {
    return other instanceof SlideBoundaryWidget
      && other.slideIndex === this.slideIndex
      && other.layout === this.layout
      && other.overBudget === this.overBudget
      && other.canSplit === this.canSplit;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class FrontMatterWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'cm-frontmatter-widget';
    element.dataset.blockFrom = String(this.from);
    element.dataset.blockTo = String(this.to);
    element.textContent = 'Presentation settings';
    element.title = 'Click to edit presentation settings';
    return element;
  }

  eq(other: WidgetType): boolean {
    return other instanceof FrontMatterWidget && other.from === this.from && other.to === this.to;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class HiddenMarkdownSyntaxWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-hidden-markdown-syntax';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function activeBlockForSelection(blocks: MarkdownBlockRange[], state: EditorState): MarkdownBlockRange | null {
  const selection = state.selection.main;
  return blocks.find((block) => selection.head >= block.from && selection.head <= block.to) || null;
}

function activeRevealRange(state: EditorState, block: MarkdownBlockRange | null, math: MathRange[]): SourceRevealRange | null {
  if (!block) return null;
  if (/^\s*(`{3,}|~{3,})/.test(block.markdown)) return { from: block.from, to: block.to };
  if (/^\s*\|.*\|\s*(?:\n|$)/.test(block.markdown) && block.markdown.split('\n').filter(Boolean).length > 1) {
    return { from: block.from, to: block.to };
  }

  const selection = state.selection.main;
  const selectedMath = math.find((range) => selection.head >= range.from && selection.head <= range.to);
  const from = Math.max(block.from, selectedMath ? selectedMath.from : selection.from);
  const to = Math.min(block.to, selectedMath ? selectedMath.to : selection.to);
  return {
    from: state.doc.lineAt(from).from,
    to: state.doc.lineAt(Math.max(from, to)).to,
  };
}

function renderedFragment(
  source: string,
  block: MarkdownBlockRange,
  from: number,
  to: number,
): MarkdownBlockRange | null {
  if (to <= from) return null;
  return {
    from,
    to,
    slideIndex: block.slideIndex,
    markdown: source.slice(from, to),
  };
}

function slideRangeForPosition(ranges: SlideSourceRange[], position: number): number {
  const match = ranges.find((range) => position >= range.start && position <= range.end);
  return match?.index ?? Math.max(0, ranges.length - 1);
}

function livePreviewDecorations(state: EditorState): DecorationSet {
  const source = state.doc.toString();
  const slides = slideSourceRanges(source);
  const parsedSlides = parseMarkdown(source).slides;
  const blocks = markdownBlockRanges(source);
  const math = findMathRanges(source);
  const activeBlock = activeBlockForSelection(blocks, state);
  const activeHeadingBlock = activeBlock && /^#\s+/.test(activeBlock.markdown) ? activeBlock : null;
  const reveal = activeRevealRange(state, activeBlock, math);
  const frontMatterEnd = slides[0]?.start ?? 0;
  const editingFrontMatter = frontMatterEnd > 0 && state.selection.main.head < frontMatterEnd;
  const decorations: Array<{ from: number; to?: number; value: Decoration }> = [];

  if (frontMatterEnd > 0 && !editingFrontMatter) {
    decorations.push({
      from: 0,
      to: frontMatterEnd,
      value: Decoration.replace({
        widget: new FrontMatterWidget(0, frontMatterEnd),
        block: true,
      }),
    });
  } else if (editingFrontMatter) {
    const firstLine = state.doc.lineAt(0);
    const lastLine = state.doc.lineAt(Math.max(0, frontMatterEnd - 1));
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = state.doc.line(number);
      decorations.push({
        from: line.from,
        value: Decoration.line({
          class: [
            'cm-frontmatter-line',
            number === firstLine.number ? 'cm-frontmatter-first' : '',
            number === lastLine.number ? 'cm-frontmatter-last' : '',
          ].filter(Boolean).join(' '),
          attributes: { 'data-frontmatter-source': 'true' },
        }),
      });
    }
  }

  for (const slide of slides) {
    if (blocks.some((block) => block.slideIndex === slide.index)) continue;
    decorations.push({
      from: slide.start,
      value: Decoration.widget({
        widget: new RenderedBlockWidget(
          { from: slide.start, to: slide.start, slideIndex: slide.index, markdown: '' },
          parsedSlides[slide.index]?.layout || 'body',
          false,
          true,
        ),
        block: true,
        side: 1,
      }),
    });
  }

  for (const slide of slides) {
    const firstLine = state.doc.lineAt(Math.min(slide.start, state.doc.length));
    const lastPosition = Math.max(slide.start, Math.min(slide.end, state.doc.length));
    const lastLine = state.doc.lineAt(lastPosition);
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = state.doc.line(number);
      const activeHeadingSurface = activeHeadingBlock?.slideIndex === slide.index
        && activeHeadingBlock.from === line.from;
      const slideSurfaceLine = number === firstLine.number || activeHeadingSurface;
      const layoutDirective = /^:{3}slide-layout\{[^}\s]+\}[ \t]*$/.test(line.text.trim());
      if (layoutDirective && activeHeadingBlock?.slideIndex === slide.index) {
        decorations.push({
          from: line.from,
          to: line.to,
          value: Decoration.replace({ widget: new HiddenMarkdownSyntaxWidget() }),
        });
        continue;
      }
      const classes = [
        'cm-slide-line',
        slideSurfaceLine
          ? (activeBlock?.slideIndex === slide.index ? 'cm-slide-first' : 'cm-slide-anchor')
          : '',
        number === lastLine.number ? 'cm-slide-last' : '',
        reveal
          && activeHeadingBlock?.from !== activeBlock?.from
          && line.to >= reveal.from
          && line.from <= reveal.to
          ? 'cm-source-revealed'
          : '',
      ].filter(Boolean).join(' ');
      decorations.push({
        from: line.from,
        value: Decoration.line({
          class: classes,
          attributes: {
            'data-slide-index': String(slide.index),
            'data-slide-surface': String(slide.index),
            ...(slideSurfaceLine
              ? {
                'data-slide-label': `Slide ${slide.index + 1}`,
                'data-slide-layout': parsedSlides[slide.index]?.layout || 'body',
              }
              : {}),
          },
        }),
      });
    }
  }

  for (const block of blocks) {
    const slide = slides[block.slideIndex];
    const firstBlock = blocks.find((candidate) => candidate.slideIndex === block.slideIndex);
    if (activeHeadingBlock?.from === block.from) {
      const prefix = block.markdown.match(/^#\s+/)?.[0];
      if (prefix) {
        decorations.push({
          from: block.from,
          to: block.from + prefix.length,
          value: Decoration.replace({ widget: new HiddenMarkdownSyntaxWidget() }),
        });
        if (block.from + prefix.length < block.to) {
          decorations.push({
            from: block.from + prefix.length,
            to: block.to,
            value: Decoration.mark({ class: 'cm-heading-source-active' }),
          });
        }
        continue;
      }
    }
    const fragments = activeBlock?.from === block.from && activeBlock.to === block.to && reveal
      ? [
        renderedFragment(source, block, block.from, Math.max(block.from, reveal.from - 1)),
        renderedFragment(source, block, Math.min(block.to, reveal.to + 1), block.to),
      ].filter((fragment): fragment is MarkdownBlockRange => fragment !== null)
      : [block];
    for (const fragment of fragments) {
      decorations.push({
        from: fragment.from,
        to: fragment.to,
        value: Decoration.replace({
          widget: new RenderedBlockWidget(
            fragment,
            parsedSlides[fragment.slideIndex]?.layout || 'body',
            block.from === firstBlock?.from,
            fragment.to === slide.end,
            fragment !== block,
          ),
          block: true,
        }),
      });
    }
  }

  for (const range of math) {
    const block = blocks.find((candidate) => range.from >= candidate.from && range.to <= candidate.to);
    if (block && (block !== activeBlock || !reveal || range.from < reveal.from || range.to > reveal.to)) continue;
    const editing = state.selection.main.from >= range.from && state.selection.main.to <= range.to;
    if (range.valid && !editing) {
      decorations.push({
        from: range.from,
        to: range.to,
        value: Decoration.replace({ widget: new MathWidget(range), inclusive: false }),
      });
    } else if (!range.valid && range.to > range.from) {
      decorations.push({
        from: range.from,
        to: range.to,
        value: Decoration.mark({ class: 'cm-math-invalid-source' }),
      });
    }
  }

  for (const slide of slides) {
    const markdownSource = source.slice(slide.start, slide.end).replace(/^\r?\n|\r?\n$/g, '');
    const overBudget = isSlideOverBudget(markdownSource);
    const widget = new SlideBoundaryWidget(
      slide.index,
      parsedSlides[slide.index]?.layout || 'body',
      overBudget,
      overBudget && splitSlideMarkdown(source, slide.index) !== null,
    );
    if (slide.delimiterStart !== null && slide.delimiterEnd !== null) {
      decorations.push({
        from: slide.delimiterStart,
        to: slide.delimiterEnd,
        value: Decoration.replace({ widget, block: true }),
      });
    } else {
      decorations.push({
        from: slide.end,
        value: Decoration.widget({ widget, block: true, side: 1 }),
      });
    }
  }

  return Decoration.set(
    decorations.map(({ from, to, value }) => (to === undefined ? value.range(from) : value.range(from, to))),
    true,
  );
}

const fixedPageMeasurements = ViewPlugin.fromClass(class {
  constructor(private readonly view: EditorView) {
    this.measure();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged) this.measure();
  }

  private measure() {
    this.view.requestMeasure({
      read: () => {
        const width = this.view.contentDOM.clientWidth;
        return Array.from(this.view.dom.querySelectorAll<HTMLElement>('.cm-slide-boundary')).map((boundary) => {
          const index = boundary.dataset.slideIndex;
          const start = this.view.dom.querySelector<HTMLElement>(`.cm-slide-first[data-slide-index="${index}"]`);
          if (!start || !width) {
            return {
              boundary,
              start,
              fill: 0,
              pageHeight: 0,
              overflowing: boundary.classList.contains('may-overflow'),
            };
          }
          const contentHeight = boundary.getBoundingClientRect().top - start.getBoundingClientRect().top;
          const pageHeight = width * 9 / 16;
          return {
            boundary,
            start,
            fill: Math.max(0, pageHeight - contentHeight),
            pageHeight,
            overflowing: contentHeight > pageHeight + 1,
          };
        });
      },
      write: (measurements) => {
        measurements.forEach(({ boundary, start, fill, pageHeight, overflowing }) => {
          boundary.style.setProperty('--slide-page-fill', `${fill}px`);
          boundary.classList.toggle('measured-overflow', overflowing);
          if (start) {
            start.style.setProperty('--slide-page-height', `${pageHeight}px`);
            start.classList.toggle('cm-slide-measured-overflow', overflowing);
          }
        });
      },
    });
  }
});

function playbackSlide(markdownSource: string): string {
  return renderedMarkdown(markdownSource || '\u00a0');
}

export function PresentationEditor({ presentation, theme, source, onSourceChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const decorationMode = useRef(new Compartment());
  const onSourceChangeRef = useRef(onSourceChange);
  const splitPreviewRef = useRef<(preview: SplitPreview) => void>(() => undefined);
  const [mode, setMode] = useState<'edit' | 'playback'>('edit');
  const [sourceMode, setSourceMode] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [splitPreview, setSplitPreview] = useState<SplitPreview | null>(null);
  const [splitUndo, setSplitUndo] = useState<{ source: string; slideIndex: number } | null>(null);
  onSourceChangeRef.current = onSourceChange;
  splitPreviewRef.current = setSplitPreview;

  const replaceDocument = (next: string, focusSlide: number) => {
    const view = viewRef.current;
    if (!view) {
      onSourceChangeRef.current(next);
      return;
    }
    const range = slideSourceRanges(next)[focusSlide];
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: range?.start ?? 0 },
      scrollIntoView: true,
    });
    view.focus();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let lastRevealedMath: { from: number; to: number; time: number; x: number; y: number } | null = null;

    const selectWidgetRange = (
      target: EventTarget | null,
      view: EditorView,
      selectMath: boolean,
      event?: MouseEvent,
    ) => {
      const element = target instanceof Element ? target : null;
      const mathElement = element?.closest<HTMLElement>('[data-math-from]');
      const blockElement = element?.closest<HTMLElement>('[data-block-from]');
      const from = Number((mathElement || blockElement)?.dataset[mathElement ? 'mathFrom' : 'blockFrom']);
      const to = Number((mathElement || blockElement)?.dataset[mathElement ? 'mathTo' : 'blockTo']);
      if (!Number.isFinite(from)) return false;
      if (mathElement && Number.isFinite(to) && event) {
        lastRevealedMath = { from, to, time: Date.now(), x: event.clientX, y: event.clientY };
      }
      let anchor = from;
      if (!mathElement && blockElement && event && Number.isFinite(to)) {
        const lines = lineOffsets(view.state.doc.toString(), from, to);
        const bounds = blockElement.getBoundingClientRect();
        if (lines.length > 1 && bounds.height > 0) {
          const ratio = Math.max(0, Math.min(0.999, (event.clientY - bounds.top) / bounds.height));
          anchor = lines[Math.floor(ratio * lines.length)]?.from ?? from;
        }
        const line = view.state.doc.lineAt(anchor);
        if (bounds.width > 0) {
          const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
          anchor = Math.min(line.to, line.from + Math.round(line.length * ratio));
        }
      }
      view.dispatch({
        selection: selectMath && Number.isFinite(to) ? { anchor: from, head: to } : { anchor },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    };

    const editor = new EditorView({
      state: EditorState.create({
        doc: source,
        selection: {
          anchor: source === ':::slide-layout{intro}\n# '
            ? source.length
            : slideSourceRanges(source)[0]?.start ?? 0,
        },
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          EditorView.lineWrapping,
          decorationMode.current.of(EditorView.decorations.compute(['doc', 'selection'], livePreviewDecorations)),
          fixedPageMeasurements,
          EditorView.domEventHandlers({
            mousedown(event, view) {
              if ((event.target as Element | null)?.closest('button')) return false;
              if ((event.target as Element | null)?.closest('input[type="checkbox"][data-task-from]')) {
                event.preventDefault();
                return true;
              }
              const surface = (event.target as Element | null)?.closest<HTMLElement>(
                '.cm-slide-first, .cm-slide-anchor',
              );
              if (surface && !surface.closest('[data-block-from]')) {
                const slideIndex = Number(surface.dataset.slideIndex);
                const range = slideSourceRanges(view.state.doc.toString())[slideIndex];
                if (range) {
                  event.preventDefault();
                  view.dispatch({ selection: { anchor: range.start }, scrollIntoView: true });
                  view.focus();
                  return true;
                }
              }
              const previous = lastRevealedMath;
              const repeatedMathClick = previous
                && Date.now() - previous.time < 600
                && Math.abs(event.clientX - previous.x) < 8
                && Math.abs(event.clientY - previous.y) < 8;
              if (repeatedMathClick) {
                event.preventDefault();
                view.dispatch({ selection: { anchor: previous.from, head: previous.to }, scrollIntoView: true });
                view.focus();
                lastRevealedMath = null;
                return true;
              }
              return selectWidgetRange(event.target, view, false, event);
            },
            click(event, view) {
              const checkbox = (event.target as Element | null)?.closest<HTMLInputElement>('input[type="checkbox"][data-task-from]');
              if (checkbox) {
                const from = Number(checkbox.dataset.taskFrom);
                const marker = view.state.sliceDoc(from, from + 3);
                if (Number.isFinite(from) && /^\[[ xX]\]$/.test(marker)) {
                  event.preventDefault();
                  view.dispatch({ changes: { from, to: from + 3, insert: marker.toLowerCase() === '[x]' ? '[ ]' : '[x]' } });
                  view.focus();
                  return true;
                }
              }
              const action = (event.target as Element | null)?.closest<HTMLElement>('[data-slide-action]');
              if (!action) return selectWidgetRange(event.target, view, false, event);
              const boundary = action.closest<HTMLElement>('.cm-slide-boundary');
              const slideIndex = Number(boundary?.dataset.slideIndex);
              if (!Number.isInteger(slideIndex)) return false;
              const current = view.state.doc.toString();
              if (action.dataset.slideAction === 'add') {
                const next = insertSlideMarkdown(current, slideIndex);
                const range = slideSourceRanges(next)[slideIndex + 1];
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: range?.start ?? next.length }, scrollIntoView: true });
              } else if (action.dataset.slideAction === 'delete') {
                const next = deleteSlideMarkdown(current, slideIndex);
                const target = Math.max(0, Math.min(slideIndex, slideSourceRanges(next).length - 1));
                const range = slideSourceRanges(next)[target];
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, selection: { anchor: range?.start ?? 0 }, scrollIntoView: true });
              } else if (action.dataset.slideAction === 'preview-split') {
                const proposed = splitSlideMarkdown(current, slideIndex);
                if (proposed) splitPreviewRef.current({ original: current, proposed, slideIndex });
              }
              view.focus();
              return true;
            },
            change(event, view) {
              const select = (event.target as Element | null)?.closest<HTMLSelectElement>('[data-slide-action="layout"]');
              if (!select) return false;
              const boundary = select.closest<HTMLElement>('.cm-slide-boundary');
              const slideIndex = Number(boundary?.dataset.slideIndex);
              if (!Number.isInteger(slideIndex) || !['body', 'intro'].includes(select.value)) return false;
              const next = setSlideLayout(view.state.doc.toString(), slideIndex, select.value as SlideLayout);
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, scrollIntoView: false });
              view.focus();
              return true;
            },
            dblclick(event, view) {
              if (selectWidgetRange(event.target, view, true, event)) return true;
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) return false;
              const range = findMathRanges(view.state.doc.toString())
                .find((candidate) => position >= candidate.from && position <= candidate.to);
              if (!range) return false;
              view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
              view.focus();
              return true;
            },
            keydown(event, view) {
              if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
              const position = view.state.selection.main.head;
              const slides = slideSourceRanges(view.state.doc.toString());
              const index = slideRangeForPosition(slides, position);
              const current = slides[index];
              if (!current) return false;
              const atBoundary = event.key === 'ArrowUp' ? position <= current.start : position >= current.end;
              const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
              if (!atBoundary || nextIndex < 0 || nextIndex >= slides.length) return false;
              event.preventDefault();
              const next = slides[nextIndex];
              view.dispatch({
                selection: { anchor: event.key === 'ArrowUp' ? next.end : next.start },
                scrollIntoView: true,
              });
              return true;
            },
          }),
          EditorView.theme({
            '&': { minHeight: '18rem', backgroundColor: 'transparent' },
            '.cm-scroller': {
              overflow: 'visible',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            onSourceChangeRef.current(next);
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = editor;
    editor.focus();
    return () => {
      editor.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === source) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }, [source]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: decorationMode.current.reconfigure(
        sourceMode ? [] : EditorView.decorations.compute(['doc', 'selection'], livePreviewDecorations),
      ),
    });
  }, [sourceMode]);

  useEffect(() => {
    setPlaybackIndex((index) => Math.min(index, Math.max(0, presentation.slides.length - 1)));
  }, [presentation.slides.length]);

  const confirmSplit = () => {
    if (!splitPreview) return;
    setSplitUndo({ source: splitPreview.original, slideIndex: splitPreview.slideIndex });
    replaceDocument(splitPreview.proposed, splitPreview.slideIndex);
    setSplitPreview(null);
  };

  return (
    <main className={`slide-list presentation-theme-${theme} presentation-editor`} aria-label={`${presentation.sourceName} slides`}>
      <section className="presentation-editor-toolbar" aria-label="Editor mode">
        <div>
          <strong>{mode === 'edit' ? 'Live preview' : 'Presentation'}</strong>
          <span>{presentation.slides.length} {presentation.slides.length === 1 ? 'slide' : 'slides'}</span>
        </div>
        <div className="presentation-editor-actions">
          <button type="button" onClick={() => setMode(mode === 'edit' ? 'playback' : 'edit')}>
            {mode === 'edit' ? 'Present' : 'Back to editor'}
          </button>
          {mode === 'edit' && (
            <button
              className={`source-mode-toggle${sourceMode ? ' active' : ''}`}
              type="button"
              role="switch"
              aria-checked={sourceMode}
              onClick={() => setSourceMode((enabled) => !enabled)}
            >
              <span className="source-mode-toggle-track" aria-hidden="true"><span /></span>
              <span>{sourceMode ? 'Full source' : 'Inline source'}</span>
            </button>
          )}
        </div>
      </section>

      <div className={`${mode === 'edit' ? 'presentation-live-canvas' : 'presentation-live-canvas hidden'}${sourceMode ? ' source-mode' : ''}`} aria-hidden={mode !== 'edit'}>
        <div ref={hostRef} className="presentation-codemirror" aria-label="Live-preview Markdown editor" />
      </div>

      {mode === 'playback' && (
        <section className="presentation-playback" aria-label="Presentation playback">
          <article
            className="slide presentation-playback-slide"
            aria-label={`Slide ${playbackIndex + 1}`}
            dangerouslySetInnerHTML={{ __html: playbackSlide(presentation.slides[playbackIndex]?.markdown || '') }}
          />
          <nav className="presentation-playback-controls" aria-label="Slide navigation">
            <button type="button" disabled={playbackIndex === 0} onClick={() => setPlaybackIndex((index) => index - 1)}>Previous</button>
            <span>{playbackIndex + 1} / {presentation.slides.length}</span>
            <button type="button" disabled={playbackIndex >= presentation.slides.length - 1} onClick={() => setPlaybackIndex((index) => index + 1)}>Next</button>
          </nav>
        </section>
      )}

      {splitPreview && (
        <section className="slide-split-preview" role="dialog" aria-label={`Automatic split preview for slide ${splitPreview.slideIndex + 1}`}>
          <strong>Preview only — your Markdown has not changed.</strong>
          <p>This would create {slideSourceRanges(splitPreview.proposed).length - slideSourceRanges(splitPreview.original).length + 1} slides from slide {splitPreview.slideIndex + 1}.</p>
          <pre>{splitPreview.proposed}</pre>
          <div>
            <button type="button" onClick={confirmSplit}>Confirm split</button>
            <button type="button" onClick={() => setSplitPreview(null)}>Cancel</button>
          </div>
        </section>
      )}

      {splitUndo && !splitPreview && (
        <div className="slide-undo-notice" role="status">
          Automatic split applied.
          <button type="button" onClick={() => { replaceDocument(splitUndo.source, splitUndo.slideIndex); setSplitUndo(null); }}>Undo</button>
        </div>
      )}
    </main>
  );
}

export { findMathRanges };
