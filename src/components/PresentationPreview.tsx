import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { replaceSlideMarkdown, splitSlideMarkdown } from '../domain/presentation';
import type { Presentation, ThemeMode } from '../domain/presentation';
import './PresentationPreview.css';

interface Props {
  presentation: Presentation;
  theme: ThemeMode;
  source: string;
  onSourceChange: (source: string) => void;
}

function serializeNode(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map((child) => serializeNode(child, depth)).join('');
  const children = Array.from(node.childNodes).map((child) => serializeNode(child, depth)).join('');
  switch (node.tagName.toLowerCase()) {
    case 'h1': return `# ${children.trim()}\n\n`;
    case 'h2': return `## ${children.trim()}\n\n`;
    case 'h3': return `### ${children.trim()}\n\n`;
    case 'strong':
    case 'b': return `**${children.trim()}**`;
    case 'em':
    case 'i': return `*${children.trim()}*`;
    case 'del':
    case 's': return `~~${children.trim()}~~`;
    case 'code': return node.parentElement?.tagName.toLowerCase() === 'pre' ? children : `\`${children}\``;
    case 'pre': {
      const language = node.querySelector('code')?.className.match(/language-([\w-]+)/)?.[1];
      return `\`\`\`${language || ''}\n${children.trim()}\n\`\`\`\n\n`;
    }
    case 'a': return `[${children.trim()}](${node.getAttribute('href') || ''})`;
    case 'img': return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
    case 'blockquote': return children.trim().split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
    case 'hr': return '---\n\n';
    case 'br': return '\n';
    case 'li': {
      const parent = node.parentElement;
      const ordered = parent?.tagName.toLowerCase() === 'ol';
      const index = ordered && parent ? Array.from(parent.children).indexOf(node) + 1 : 0;
      return `${'  '.repeat(Math.max(0, depth - 1))}${ordered ? `${index}.` : '-'} ${children.trim()}\n`;
    }
    case 'ul':
    case 'ol': return `${children}\n`;
    case 'p': return `${children.trim()}\n\n`;
    case 'th':
    case 'td': return `${children.trim()} | `;
    case 'tr': return `| ${children.trim()}\n`;
    case 'input': return node.getAttribute('type') === 'checkbox'
      ? `[${(node as HTMLInputElement).checked ? 'x' : ' '}] `
      : '';
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (!rows.length) return '';
      const lines = rows.map((row) => `| ${Array.from(row.children).map((cell) => serializeNode(cell).trim()).join(' | ')} |`);
      const header = rows[0].querySelector('th') ? `| ${Array.from(rows[0].children).map(() => '---').join(' | ')} |` : '';
      if (header) lines.splice(1, 0, header);
      return `${lines.join('\n')}\n\n`;
    }
    default: return children;
  }
}

function serializeSlide(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelector('.slide-number')?.remove();
  clone.querySelector('.empty-slide')?.remove();
  return serializeNode(clone).replace(/\n{3,}/g, '\n\n').trim();
}

export function PresentationPreview({ presentation, theme, source, onSourceChange }: Props) {
  const [editingSlide, setEditingSlide] = useState<number | null>(null);
  const [sourceSlide, setSourceSlide] = useState<number | null>(null);
  const [overflowSlides, setOverflowSlides] = useState<Set<number>>(new Set());
  const [overflowPrompt, setOverflowPrompt] = useState<number | null>(null);
  const slideRefs = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    const measure = () => {
      const next = new Set<number>();
      slideRefs.current.forEach((element, index) => {
        if (element.scrollHeight > element.clientHeight + 4) next.add(index);
      });
      setOverflowSlides(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    slideRefs.current.forEach((element) => observer?.observe(element));
    return () => observer?.disconnect();
  }, [presentation.slides, sourceSlide]);
  useEffect(() => {
    if (sourceSlide === null) return;
    const exitSourceMode = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSourceSlide(null);
    };
    window.addEventListener('keydown', exitSourceMode);
    return () => window.removeEventListener('keydown', exitSourceMode);
  }, [sourceSlide]);
  return (
    <main className={`slide-list presentation-theme-${theme}`} aria-label={`${presentation.sourceName} slides`}>
      {presentation.slides.map((slide) => (
        <div className="slide-shell" key={slide.id}>
          <article
            ref={(element) => {
              if (element) slideRefs.current.set(slide.index, element);
              else slideRefs.current.delete(slide.index);
            }}
            className={`slide${editingSlide === slide.index ? ' editing' : ''}${sourceSlide === slide.index ? ' source-mode' : ''}`}
            aria-label={`Slide ${slide.index + 1}`}
            contentEditable={editingSlide === slide.index}
            suppressContentEditableWarning
            onClick={() => { if (sourceSlide === null) setEditingSlide(slide.index); }}
            onDoubleClick={(event) => { event.stopPropagation(); setSourceSlide(slide.index); setEditingSlide(null); }}
            onBlur={(event) => {
              if (editingSlide === slide.index) {
                onSourceChange(replaceSlideMarkdown(source, slide.index, serializeSlide(event.currentTarget)));
                setEditingSlide(null);
                if (event.currentTarget.scrollHeight > event.currentTarget.clientHeight + 4) setOverflowPrompt(slide.index);
              }
            }}
          >
            {sourceSlide === slide.index ? (
            <div className="slide-source-inline">
              <div className="slide-source-inline-toolbar">
                <strong>Slide {slide.index + 1} Markdown</strong>
                <button type="button" onClick={() => setSourceSlide(null)}>Preview</button>
              </div>
              <textarea
                autoFocus
                aria-label={`Markdown source for slide ${slide.index + 1}`}
                value={slide.markdown}
                onChange={(event) => onSourceChange(replaceSlideMarkdown(source, slide.index, event.target.value))}
                onKeyDown={(event) => { if (event.key === 'Escape') setSourceSlide(null); }}
                onBlur={() => {
                  const element = slideRefs.current.get(slide.index);
                  if (element && element.scrollHeight > element.clientHeight + 4) setOverflowPrompt(slide.index);
                }}
              />
            </div>
            ) : slide.markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{slide.markdown}</ReactMarkdown>
            ) : (
              <p className="empty-slide">This slide is empty.</p>
            )}
            <span className="slide-number">{slide.index + 1}</span>
          </article>
          {overflowSlides.has(slide.index) && (
            <button
              className="slide-overflow-trigger"
              type="button"
              aria-label={`Slide ${slide.index + 1} has overflow`}
              onClick={() => setOverflowPrompt(slide.index)}
            >
              ↗
            </button>
          )}
          {overflowPrompt === slide.index && (
            <div className="slide-overflow-popover" role="dialog" aria-label={`Slide ${slide.index + 1} overflow`}>
              <strong>This slide is getting crowded.</strong>
              <p>Split it at its top-level headings?</p>
              {splitSlideMarkdown(source, slide.index) ? (
                <button type="button" onClick={() => { onSourceChange(splitSlideMarkdown(source, slide.index)!); setOverflowPrompt(null); setSourceSlide(null); }}>Split slide</button>
              ) : (
                <p className="slide-overflow-empty">No safe heading split was found. Use Markdown Source to add a <code>---</code> separator.</p>
              )}
              <button type="button" className="slide-overflow-keep" onClick={() => setOverflowPrompt(null)}>Keep as is</button>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
