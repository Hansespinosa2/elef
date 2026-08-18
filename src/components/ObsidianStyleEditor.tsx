import { useEffect, useMemo, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
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
  slideSourceRanges,
} from '../domain/presentation';
import type { Presentation, SlideSourceRange, ThemeMode } from '../domain/presentation';
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

class MathWidget extends WidgetType {
  constructor(private readonly range: MathRange) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.range.display ? 'div' : 'span');
    element.className = `cm-math-widget${this.range.valid ? '' : ' cm-math-invalid'}`;
    element.dataset.mathSource = this.range.source;
    element.title = this.range.valid ? 'Double-click to edit TeX' : 'Invalid TeX — source retained';
    if (this.range.valid) {
      try {
        element.innerHTML = katex.renderToString(this.range.source, {
          displayMode: this.range.display,
          throwOnError: true,
        });
      } catch {
        element.textContent = this.range.source;
        element.classList.add('cm-math-invalid');
      }
    } else {
      element.textContent = element.dataset.mathSource;
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

function mathDecorations(state: EditorState): DecorationSet {
  const builder: { from: number; to: number; decoration: Decoration }[] = [];
  const source = state.doc.toString();
  const cursor = state.selection.main;
  for (const range of findMathRanges(source)) {
    const editing = cursor.from >= range.from && cursor.to <= range.to;
    if (range.valid && !editing) {
      builder.push({
        from: range.from,
        to: range.to,
        decoration: Decoration.replace({ widget: new MathWidget(range), inclusive: false }),
      });
    } else if (!range.valid) {
      if (range.from === range.to) continue;
      builder.push({
        from: range.from,
        to: range.to,
        decoration: Decoration.mark({ class: 'cm-math-invalid-source' }),
      });
    }
  }
  return Decoration.set(builder.map(({ from, to, decoration }) => decoration.range(from, to)), true);
}

function slideRangeForPosition(ranges: SlideSourceRange[], position: number): number {
  const match = ranges.find((range) => position >= range.start && position <= range.end);
  return match?.index ?? Math.max(0, ranges.length - 1);
}

function renderSlide(markdown: string): JSX.Element {
  const math = findMathRanges(markdown);
  if (math.some((range) => !range.valid)) {
    return <pre className="slide-invalid-tex" role="alert">{markdown}</pre>;
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {markdown || '\u00a0'}
    </ReactMarkdown>
  );
}

export function ObsidianStyleEditor({ presentation, theme, source, onSourceChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const sourceRef = useRef(source);
  const onSourceChangeRef = useRef(onSourceChange);
  onSourceChangeRef.current = onSourceChange;
  sourceRef.current = source;

  const ranges = useMemo(() => slideSourceRanges(source), [source]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const rangePrototype = Range.prototype as Range & {
      getClientRects?: () => DOMRectList;
      getBoundingClientRect?: () => DOMRect;
    };
    const originalClientRects = rangePrototype.getClientRects;
    const originalBoundingRect = rangePrototype.getBoundingClientRect;
    const hadClientRects = typeof rangePrototype.getClientRects === 'function';
    const hadBoundingRect = typeof rangePrototype.getBoundingClientRect === 'function';
    if (!hadClientRects) Object.defineProperty(rangePrototype, 'getClientRects', { configurable: true, value: () => [] });
    if (!hadBoundingRect) Object.defineProperty(rangePrototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const editor = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          EditorView.lineWrapping,
          EditorView.decorations.compute(['doc', 'selection'], mathDecorations),
          EditorView.domEventHandlers({
            dblclick(event, view) {
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) return false;
              const match = findMathRanges(view.state.doc.toString()).find((range) => position >= range.from && position <= range.to);
              if (!match) return false;
              view.dispatch({ selection: { anchor: match.from, head: match.to } });
              view.focus();
              return true;
            },
            keydown(event, view) {
              if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
              const position = view.state.selection.main.head;
              const currentRanges = slideSourceRanges(view.state.doc.toString());
              const index = slideRangeForPosition(currentRanges, position);
              const current = currentRanges[index];
              if (!current) return false;
              const atBoundary = event.key === 'ArrowUp' ? position <= current.start : position >= current.end;
              const nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
              if (!atBoundary || nextIndex < 0 || nextIndex >= currentRanges.length) return false;
              const next = currentRanges[nextIndex];
              const target = event.key === 'ArrowUp' ? next.end : next.start;
              event.preventDefault();
              view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
              return true;
            },
          }),
          EditorView.theme({
            '&': { height: '100%', minHeight: '18rem' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            sourceRef.current = next;
            onSourceChangeRef.current(next);
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = editor;
    return () => {
      editor.destroy();
      viewRef.current = null;
      if (!hadClientRects) Object.defineProperty(rangePrototype, 'getClientRects', { configurable: true, value: originalClientRects });
      if (!hadBoundingRect) Object.defineProperty(rangePrototype, 'getBoundingClientRect', { configurable: true, value: originalBoundingRect });
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === source) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }, [source]);

  const focusSlide = (index: number) => {
    const view = viewRef.current;
    const range = slideSourceRanges(view?.state.doc.toString() || source)[index];
    pendingFocusRef.current = index;
    if (!view || !range) return;
    view.dispatch({ selection: { anchor: range.start }, scrollIntoView: true });
    view.focus();
    pendingFocusRef.current = null;
  };

  useEffect(() => {
    const index = pendingFocusRef.current;
    const view = viewRef.current;
    if (index === null || !view) return;
    const range = slideSourceRanges(view.state.doc.toString())[index];
    if (!range) return;
    view.dispatch({ selection: { anchor: range.start }, scrollIntoView: true });
    view.focus();
    pendingFocusRef.current = null;
  }, [source]);

  return (
    <main className={`slide-list presentation-theme-${theme} obsidian-editor`} aria-label={`${presentation.sourceName} slides`}>
      <section className="obsidian-editor-toolbar" aria-label="Markdown editor">
        <strong>Markdown</strong>
        <span>One document · {presentation.slides.length} {presentation.slides.length === 1 ? 'slide' : 'slides'}</span>
      </section>
      <div className="obsidian-editor-pages">
        {presentation.slides.map((slide) => {
          const range = ranges[slide.index];
          return (
            <div className="slide-viewport" key={slide.id}>
              <article
                className="slide obsidian-slide-page"
                aria-label={`Slide ${slide.index + 1}`}
                tabIndex={0}
                onClick={() => focusSlide(slide.index)}
              >
                {renderSlide(slide.markdown)}
                <span className="slide-number" aria-hidden="true">{slide.index + 1}</span>
              </article>
              <div className="slide-boundary" role="group" aria-label={`Actions for slide ${slide.index + 1}`}>
                <button
                  className="slide-delete-button"
                  type="button"
                  aria-label={`Delete slide ${slide.index + 1}`}
                  onClick={() => {
                    onSourceChange(deleteSlideMarkdown(source, slide.index));
                    focusSlide(Math.max(0, Math.min(slide.index, presentation.slides.length - 2)));
                  }}
                >−</button>
                <button
                  className="slide-add-button"
                  type="button"
                  aria-label={`Add slide after slide ${slide.index + 1}`}
                  onClick={() => {
                    onSourceChange(insertSlideMarkdown(source, slide.index));
                    focusSlide(slide.index + 1);
                  }}
                >+</button>
              </div>
              {range && <span className="slide-source-range" aria-hidden="true">{range.start}:{range.end}</span>}
            </div>
          );
        })}
      </div>
      <section className="obsidian-source-panel" aria-label="Continuous Markdown source">
        <div ref={hostRef} className="obsidian-codemirror" />
      </section>
    </main>
  );
}

export { findMathRanges };
