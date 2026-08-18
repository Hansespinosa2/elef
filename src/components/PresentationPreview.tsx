import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSlideOverBudget, replaceSlideMarkdown, splitSlideMarkdown } from '../domain/presentation';
import type { Presentation, ThemeMode } from '../domain/presentation';
import './PresentationPreview.css';

const slideWidth = 1280;
const slideHeight = 720;
const minimumSlideScale = 0.75;

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

function toggleTaskItem(markdown: string, taskIndex: number): string {
  let fence = false;
  let currentTask = 0;
  return markdown.split('\n').map((line) => {
    if (/^(\s*)(`{3,}|~{3,})/.test(line)) {
      fence = !fence;
      return line;
    }
    if (fence || !/^\s*[-*+]\s+\[[ xX]\]/.test(line)) return line;
    if (currentTask++ !== taskIndex) return line;
    return line.replace(/(\s*[-*+]\s+)\[([ xX])\]/, (_, prefix: string, state: string) => `${prefix}[${state.trim() ? ' ' : 'x'}]`);
  }).join('\n');
}

function placeCaretAtEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtPoint(element: HTMLElement, x: number, y: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  const documentWithCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (documentWithCaret.caretRangeFromPoint) {
    range = documentWithCaret.caretRangeFromPoint(x, y);
  } else if (documentWithCaret.caretPositionFromPoint) {
    const position = documentWithCaret.caretPositionFromPoint(x, y);
    if (position) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  }
  if (!range || !element.contains(range.startContainer)) {
    placeCaretAtEnd(element);
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function splitMarkdownBlocks(markdown: string): string[] {
  type BlockKind = 'fence' | 'list' | 'quote' | 'table' | 'text';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let fence = false;
  let blockKind: BlockKind = 'text';

  const flush = () => {
    const value = current.join('\n').trim();
    if (value) blocks.push(value);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const startsFence = /^(`{3,}|~{3,})/.test(trimmed);
    if (startsFence) {
      if (!fence) {
        flush();
        blockKind = 'fence';
      }
      current.push(line);
      fence = !fence;
      if (!fence) flush();
      continue;
    }
    if (fence) {
      current.push(line);
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }

    const nextKind: BlockKind = /^>\s?/.test(trimmed)
      ? 'quote'
      : /^([-*+]|\d+[.)])\s+/.test(trimmed)
        ? 'list'
        : /^\|/.test(trimmed)
          ? 'table'
          : /^(#{1,3})\s+/.test(trimmed) || /^---+$/.test(trimmed)
            ? 'text'
            : blockKind;
    if (current.length && nextKind !== blockKind && !(blockKind === 'text' && nextKind === 'text')) flush();
    blockKind = nextKind;
    current.push(line);
  }
  flush();
  return blocks;
}

function handleListEnter(element: HTMLElement, event: ReactKeyboardEvent<HTMLElement>): boolean {
  if (event.key !== 'Enter') return false;
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  const item = anchorElement?.closest('li');
  if (!item || !element.contains(item)) return false;
  const list = item.parentElement;
  if (!list || !/^(UL|OL)$/.test(list.tagName)) return false;

  event.preventDefault();
  const hasCheckbox = Boolean(item.querySelector('input[type="checkbox"]'));
  if (!item.textContent?.trim()) {
    if (list.children.length > 1) {
      item.remove();
      const previous = list.lastElementChild;
      if (previous instanceof HTMLElement) placeCaretAtEnd(previous);
    } else {
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      list.replaceWith(paragraph);
      placeCaretAtEnd(paragraph);
    }
    return true;
  }

  const next = document.createElement('li');
  if (hasCheckbox) {
    next.className = 'task-list-item';
    const wrapper = document.createElement('span');
    wrapper.className = 'task-checkbox';
    wrapper.setAttribute('contenteditable', 'false');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('contenteditable', 'false');
    wrapper.append(checkbox);
    next.append(wrapper);
  }
  next.append(document.createElement('br'));
  item.after(next);
  placeCaretAtEnd(next);
  return true;
}

function handleMarkdownShortcut(element: HTMLElement, event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
  if (handleListEnter(element, event)) return;
  if (event.key !== ' ') return;
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  const block = anchorElement?.closest('p, div, h1, h2, h3, blockquote, li');
  if (!block || !element.contains(block)) return;

  const marker = block.textContent || '';
  const listTask = block.tagName.toLowerCase() === 'li' && (marker === '[ ]' || marker === '[x]');
  const heading = marker.match(/^(#{1,3})$/);
  const task = marker === '- [ ]' || marker === '- [x]';
  const unordered = marker === '-';
  const ordered = /^\d+\.$/.test(marker);
  if (!heading && !task && !listTask && !unordered && !ordered) return;

  event.preventDefault();
  if (listTask) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = marker === '[x]';
    checkbox.setAttribute('contenteditable', 'false');
    block.classList.add('task-list-item');
    const checkboxWrapper = document.createElement('span');
    checkboxWrapper.className = 'task-checkbox';
    checkboxWrapper.setAttribute('contenteditable', 'false');
    checkboxWrapper.append(checkbox);
    const taskText = document.createElement('span');
    taskText.className = 'task-text';
    taskText.append(document.createElement('br'));
    block.replaceChildren(checkboxWrapper, taskText);
    placeCaretAtEnd(taskText);
    return;
  }
  if (heading) {
    const headingElement = document.createElement(`h${heading[1].length}`);
    headingElement.append(document.createElement('br'));
    block.replaceWith(headingElement);
    placeCaretAtEnd(headingElement);
    return;
  }

  const list = document.createElement(ordered ? 'ol' : 'ul');
  const item = document.createElement('li');
  if (task) {
    list.classList.add('contains-task-list');
    item.classList.add('task-list-item');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = marker.endsWith('[x]');
    checkbox.setAttribute('contenteditable', 'false');
    const checkboxWrapper = document.createElement('span');
    checkboxWrapper.className = 'task-checkbox';
    checkboxWrapper.setAttribute('contenteditable', 'false');
    checkboxWrapper.append(checkbox);
    const taskText = document.createElement('span');
    taskText.className = 'task-text';
    taskText.append(document.createElement('br'));
    item.append(checkboxWrapper, taskText);
  }
  item.append(document.createElement('br'));
  list.append(item);
  block.replaceWith(list);
  placeCaretAtEnd(item);
}

export function PresentationPreview({ presentation, theme, source, onSourceChange }: Props) {
  const [editingSlide, setEditingSlide] = useState<number | null>(null);
  const [sourceBlock, setSourceBlock] = useState<{ slideIndex: number; blockIndex: number } | null>(null);
  const [sourceDraft, setSourceDraft] = useState('');
  const [overflowPrompt, setOverflowPrompt] = useState<number | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const editClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [availableWidth, setAvailableWidth] = useState(slideWidth);
  const slideScale = Math.max(minimumSlideScale, Math.min(1, availableWidth / slideWidth));
  const overflowSlides = new Set(
    presentation.slides.filter((slide) => isSlideOverBudget(slide.markdown)).map((slide) => slide.index),
  );
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const updateWidth = () => setAvailableWidth(preview.clientWidth);
    updateWidth();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth);
    observer?.observe(preview);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    if (!sourceBlock) return;
    const exitSourceMode = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSourceBlock(null);
    };
    window.addEventListener('keydown', exitSourceMode);
    return () => window.removeEventListener('keydown', exitSourceMode);
  }, [sourceBlock]);
  useEffect(() => () => {
    if (editClickTimer.current) clearTimeout(editClickTimer.current);
  }, []);
  return (
    <main ref={previewRef} className={`slide-list presentation-theme-${theme}`} aria-label={`${presentation.sourceName} slides`}>
      {presentation.slides.map((slide) => (
        <div className="slide-viewport" key={slide.id}>
          <div className="slide-shell" style={{ width: slideWidth * slideScale, height: slideHeight * slideScale }}>
          <article
            className={`slide${editingSlide === slide.index ? ' editing' : ''}${sourceBlock?.slideIndex === slide.index ? ' source-mode' : ''}`}
            style={{ width: slideWidth, height: slideHeight, transform: `scale(${slideScale})` }}
            aria-label={`Slide ${slide.index + 1}`}
            contentEditable={sourceBlock?.slideIndex === slide.index ? undefined : editingSlide === slide.index}
            suppressContentEditableWarning
            onClick={(event) => {
              if (sourceBlock) return;
              if (editingSlide === slide.index) return;
              if (editClickTimer.current) clearTimeout(editClickTimer.current);
              const article = event.currentTarget;
              const { clientX, clientY } = event;
              editClickTimer.current = setTimeout(() => {
                setEditingSlide(slide.index);
                requestAnimationFrame(() => {
                  placeCaretAtPoint(article, clientX, clientY);
                });
              }, 180);
            }}
            onKeyDown={editingSlide === slide.index && !sourceBlock
              ? (event) => handleMarkdownShortcut(event.currentTarget, event)
              : undefined}
            onBlur={(event) => {
              if (editingSlide === slide.index) {
                onSourceChange(replaceSlideMarkdown(source, slide.index, serializeSlide(event.currentTarget)));
                setEditingSlide(null);
                if (isSlideOverBudget(serializeSlide(event.currentTarget))) setOverflowPrompt(slide.index);
              }
            }}
          >
            {slide.markdown ? splitMarkdownBlocks(slide.markdown).map((block, blockIndex) => (
              sourceBlock?.slideIndex === slide.index && sourceBlock.blockIndex === blockIndex ? (
                <div className="slide-source-block" key={`source-${blockIndex}`}>
                  <textarea
                    autoFocus
                    aria-label={`Markdown source for slide ${slide.index + 1}, block ${blockIndex + 1}`}
                    value={sourceDraft}
                    onChange={(event) => {
                      setSourceDraft(event.target.value);
                      const blocks = splitMarkdownBlocks(slide.markdown);
                      blocks[blockIndex] = event.target.value;
                      onSourceChange(replaceSlideMarkdown(source, slide.index, blocks.join('\n\n')));
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Escape') setSourceBlock(null);
                    }}
                    onBlur={(event) => {
                      if (isSlideOverBudget(event.currentTarget.value)) setOverflowPrompt(slide.index);
                    }}
                  />
                </div>
              ) : (
                <div
                  className="slide-preview-block"
                  key={`preview-${blockIndex}`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (editClickTimer.current) clearTimeout(editClickTimer.current);
                    editClickTimer.current = null;
                    setSourceBlock({ slideIndex: slide.index, blockIndex });
                    setSourceDraft(block);
                    setEditingSlide(null);
                  }}
                >
                  {(() => {
                    let taskIndex = 0;
                    return (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          input: ({ checked, ...props }) => {
                            const index = taskIndex++;
                            return (
                              <span className="task-checkbox" contentEditable={false}>
                                <input
                                  {...props}
                                  type="checkbox"
                                  checked={checked}
                                  disabled={false}
                                  contentEditable={false}
                                  onChange={() => undefined}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSourceChange(replaceSlideMarkdown(source, slide.index, toggleTaskItem(slide.markdown, index)));
                                  }}
                                />
                              </span>
                            );
                          },
                        }}
                      >
                        {block}
                      </ReactMarkdown>
                    );
                  })()}
                </div>
              )
            )) : (
              <p className="empty-slide">This slide is empty.</p>
            )}
            <span className="slide-number" contentEditable={false} aria-hidden="true">{slide.index + 1}</span>
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
                <button type="button" onClick={() => { onSourceChange(splitSlideMarkdown(source, slide.index)!); setOverflowPrompt(null); setSourceBlock(null); }}>Split slide</button>
              ) : (
                <p className="slide-overflow-empty">No safe heading split was found. Use Markdown Source to add a <code>---</code> separator.</p>
              )}
              <button type="button" className="slide-overflow-keep" onClick={() => setOverflowPrompt(null)}>Keep as is</button>
            </div>
          )}
          </div>
        </div>
      ))}
    </main>
  );
}
