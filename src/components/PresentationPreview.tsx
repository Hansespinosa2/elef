import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  deleteSlideMarkdown,
  insertSlideMarkdown,
  isSlideOverBudget,
  replaceSlideMarkdown,
  splitSlideAtSeparator,
  splitSlideMarkdown,
} from '../domain/presentation';
import type { Presentation, ThemeMode } from '../domain/presentation';
import './PresentationPreview.css';
import 'katex/dist/katex.min.css';

function preserveRenderedMath() {
  return (tree: { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: unknown[] }) => {
    const visit = (node: typeof tree) => {
      const classes = Array.isArray(node.properties?.className) ? node.properties.className : [];
      if (node.tagName === 'span' && (classes.includes('katex') || classes.includes('katex-display'))) {
        const findAnnotation = (child: unknown): string | null => {
          if (!child || typeof child !== 'object') return null;
          const candidate = child as { tagName?: string; value?: string; children?: unknown[] };
          if (candidate.tagName === 'annotation') return candidate.children?.find((item) => typeof item === 'object' && item !== null && 'value' in item) instanceof Object
            ? String((candidate.children?.find((item) => typeof item === 'object' && item !== null && 'value' in item) as { value: string }).value)
            : null;
          return candidate.children?.map(findAnnotation).find((value): value is string => value !== null) || null;
        };
        const source = findAnnotation(node);
        if (source !== null) {
          node.properties = {
            ...node.properties,
            'data-math-source': source,
            'data-math-display': classes.includes('katex-display') ? 'true' : 'false',
          };
        }
      }
      node.children?.forEach((child) => {
        if (typeof child === 'object' && child !== null) visit(child as typeof tree);
      });
    };
    visit(tree);
  };
}

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
  if (node.dataset.mathSource !== undefined) {
    return node.dataset.mathDisplay === 'true'
      ? `$$\n${node.dataset.mathSource}\n$$\n\n`
      : `$${node.dataset.mathSource}$`;
  }
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

export function serializeSlide(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelector('.slide-number')?.remove();
  const emptyHeading = clone.querySelector('.empty-slide-heading');
  if (emptyHeading && !emptyHeading.textContent?.trim()) emptyHeading.remove();
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
  const slideNumber = element.querySelector('.slide-number');
  if (slideNumber) {
    range.setStartBefore(slideNumber);
    range.collapse(true);
  } else {
    range.selectNodeContents(element);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtStart(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionOffset(element: HTMLElement): { before: string; after: string } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !element.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(selection.anchorNode, selection.anchorOffset);
  const after = document.createRange();
  after.selectNodeContents(element);
  after.setStart(selection.anchorNode, selection.anchorOffset);
  const withoutSlideNumber = (content: DocumentFragment): string => {
    content.querySelector('.slide-number')?.remove();
    return content.textContent || '';
  };
  return {
    before: withoutSlideNumber(before.cloneContents()),
    after: withoutSlideNumber(after.cloneContents()),
  };
}

const editableBlockSelector = 'h1, h2, h3, p, blockquote, pre, table, ul, ol, li, div:not(.slide)';

function adjacentEditableBlock(block: HTMLElement, direction: -1 | 1): HTMLElement | null {
  let sibling = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
  while (sibling) {
    if (sibling instanceof HTMLElement && sibling.matches(editableBlockSelector)) return sibling;
    sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return null;
}

function skipEmptyAdjacentBlock(
  block: HTMLElement,
  direction: -1 | 1,
  atBoundary: boolean,
): HTMLElement | null {
  if (!atBoundary) return null;
  const emptyBlock = adjacentEditableBlock(block, direction);
  if (!emptyBlock || emptyBlock.textContent?.trim()) return null;
  let target = adjacentEditableBlock(emptyBlock, direction);
  while (target && !target.textContent?.trim()) target = adjacentEditableBlock(target, direction);
  return target;
}

function placeCaretAtBlockBoundary(block: HTMLElement, start: boolean): void {
  const content = block.matches('h1, h2, h3, p, blockquote, pre, table, ul, ol, li')
    ? block
    : block.querySelector<HTMLElement>('h1, h2, h3, p, blockquote, pre, table, ul, ol, li') || block;
  (start ? placeCaretAtStart : placeCaretAtEnd)(content);
}

function caretAtVisibleBottom(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (typeof range.getBoundingClientRect !== 'function') return false;
  const caretRect = range.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return caretRect.bottom >= elementRect.bottom - 4;
}

function typingSlideSeparatorBlock(element: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed) return null;
  const anchor = selection.anchorNode;
  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  const block = anchorElement?.closest<HTMLElement>('p, div, h1, h2, h3, blockquote, li');
  if (!block || !element.contains(block) || block.textContent !== '--') return null;
  const position = selectionOffset(block);
  return position?.before === '--' && position.after === '' ? block : null;
}

function isTypingSlideSeparator(element: HTMLElement): boolean {
  return typingSlideSeparatorBlock(element) !== null;
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
    blockKind = 'text';
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
    const paragraph = document.createElement('p');
    paragraph.append(document.createElement('br'));
    item.remove();
    if (list.children.length) {
      list.after(paragraph);
    } else {
      list.replaceWith(paragraph);
    }
    placeCaretAtEnd(paragraph);
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
  const [sourceBlock, setSourceBlock] = useState<{ slideIndex: number; blockIndex: number } | null>(null);
  const [sourceDraft, setSourceDraft] = useState('');
  const [overflowPrompt, setOverflowPrompt] = useState<number | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [undoDelete, setUndoDelete] = useState<{ source: string; slideIndex: number; scrollY: number } | null>(null);
  const [contentVersion, setContentVersion] = useState(0);
  const previewRef = useRef<HTMLElement>(null);
  const slideRefs = useRef(new Map<number, HTMLElement>());
  const pendingFocus = useRef<{ index: number; start: boolean } | null>(null);
  const editingSource = useRef<{ slideIndex: number; markdown: string } | null>(null);
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
    const exitOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.slide-source-block')) {
        setSourceBlock(null);
      }
    };
    window.addEventListener('keydown', exitSourceMode);
    window.addEventListener('pointerdown', exitOnOutsideClick, true);
    return () => {
      window.removeEventListener('keydown', exitSourceMode);
      window.removeEventListener('pointerdown', exitOnOutsideClick, true);
    };
  }, [sourceBlock]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const element = slideRefs.current.get(pending.index);
    if (!element) return;
    element.focus();
    (pending.start ? placeCaretAtStart : placeCaretAtEnd)(element);
    pendingFocus.current = null;
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    window.scrollTo?.({ top: undoDelete?.scrollY ?? window.scrollY, behavior: 'auto' });
  }, [activeSlide, presentation.slides, undoDelete]);
  useEffect(() => {
    if (!undoDelete) return;
    const timer = window.setTimeout(() => setUndoDelete(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoDelete]);
  useEffect(() => {
    setActiveSlide((index) => Math.min(index, Math.max(0, presentation.slides.length - 1)));
  }, [presentation.slides.length]);
  const focusSlide = (index: number, start: boolean) => {
    pendingFocus.current = { index, start };
    setActiveSlide(index);
  };
  const changeSlide = (index: number, nextSource: string, start: boolean) => {
    if (import.meta.env.DEV) console.debug('[elef] preview mutation', { action: 'changeSlide', phase: 'before-source-change', slideIndex: index });
    editingSource.current = null;
    setSourceBlock(null);
    setOverflowPrompt(null);
    focusSlide(index, start);
    onSourceChange(nextSource);
    if (import.meta.env.DEV) console.debug('[elef] preview mutation', { action: 'changeSlide', phase: 'source-change-dispatched', slideIndex: index });
  };
  return (
    <main ref={previewRef} className={`slide-list presentation-theme-${theme}`} aria-label={`${presentation.sourceName} slides`}>
      {presentation.slides.map((slide) => (
        <div className="slide-viewport" key={slide.id}>
          <div className="slide-shell" style={{ width: slideWidth * slideScale, height: slideHeight * slideScale }}>
          <article
            key={`${slide.id}-${contentVersion}`}
            ref={(element) => {
              if (element) slideRefs.current.set(slide.index, element);
              else slideRefs.current.delete(slide.index);
            }}
            className={`slide${sourceBlock?.slideIndex === slide.index ? ' source-mode' : ''}${activeSlide === slide.index ? ' editing' : ''}`}
            style={{ width: slideWidth, height: slideHeight, transform: `scale(${slideScale})` }}
            aria-label={`Slide ${slide.index + 1}`}
            contentEditable={sourceBlock?.slideIndex === slide.index ? undefined : true}
            suppressContentEditableWarning
            onClick={(event) => {
              if (sourceBlock) {
                if (!(event.target instanceof Element) || !event.target.closest('.slide-source-block')) {
                  setSourceBlock(null);
                }
                return;
              }
              const blockElement = event.target instanceof Element
                ? event.target.closest<HTMLElement>('[data-block-index]')
                : null;
              const blockIndex = blockElement ? Number(blockElement.dataset.blockIndex) : null;
              editingSource.current = { slideIndex: slide.index, markdown: slide.markdown };
              setActiveSlide(slide.index);
            }}
            onKeyDown={!sourceBlock
              ? (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  const target = event.target instanceof Element ? event.target : null;
                  const anchor = window.getSelection()?.anchorNode;
                  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
                  const block = target?.closest<HTMLElement>('[data-block-index]')
                    || anchorElement?.closest<HTMLElement>('[data-block-index]');
                  const blockIndex = block ? Number(block.dataset.blockIndex) : null;
                  if (blockIndex !== null) {
                    event.preventDefault();
                    const blocks = splitMarkdownBlocks(slide.markdown);
                    setSourceBlock({ slideIndex: slide.index, blockIndex });
                    setSourceDraft(blocks[blockIndex] || '');
                    return;
                  }
                }
                if (
                  event.key === '-'
                  && !event.shiftKey
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && isTypingSlideSeparator(event.currentTarget)
                ) {
                  event.preventDefault();
                  const markdown = serializeSlide(event.currentTarget).replace(/(^|\n)--(?=\n|$)/, '$1---');
                  const nextSource = splitSlideAtSeparator(source, slide.index, markdown);
                  if (nextSource !== source) {
                    setUndoDelete(null);
                    setContentVersion((version) => version + 1);
                    changeSlide(slide.index + 1, nextSource, true);
                  }
                  return;
                }
                if (
                  event.key === 'Backspace'
                  && !event.shiftKey
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && !serializeSlide(event.currentTarget).trim()
                  && slide.index > 0
                  && window.getSelection()?.isCollapsed
                ) {
                  event.preventDefault();
                  const scrollY = window.scrollY;
                  setUndoDelete({ source, slideIndex: slide.index, scrollY });
                  changeSlide(slide.index - 1, deleteSlideMarkdown(source, slide.index), false);
                  return;
                }
                if (
                  (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                  && !event.shiftKey
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && window.getSelection()?.isCollapsed
                ) {
                  const anchor = window.getSelection()?.anchorNode;
                  const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
                  const block = anchorElement?.closest<HTMLElement>('[data-block-index]')
                    || anchorElement?.closest<HTMLElement>(editableBlockSelector);
                  if (block && block !== event.currentTarget) {
                    const blockPosition = selectionOffset(block);
                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                    if (
                      direction > 0
                      && blockPosition?.after.trim()
                      && caretAtVisibleBottom(event.currentTarget)
                    ) {
                      event.preventDefault();
                      placeCaretAtBlockBoundary(block, false);
                      return;
                    }
                    const emptyTarget = skipEmptyAdjacentBlock(
                      block,
                      direction,
                      direction < 0
                        ? blockPosition?.after.trim() === ''
                        : blockPosition?.before.trim() === '',
                    );
                    const blockBoundary = direction < 0
                      ? blockPosition?.before.trim() === ''
                      : blockPosition?.after.trim() === '';
                    const target = emptyTarget
                      || (blockBoundary ? adjacentEditableBlock(block, direction) : null);
                    if (target) {
                      event.preventDefault();
                      placeCaretAtBlockBoundary(target, direction > 0);
                      return;
                    }
                  }
                  const position = selectionOffset(event.currentTarget);
                  const atStart = position && position.before.trim() === '';
                  const atEnd = position && position.after.trim() === '';
                  if (event.key === 'ArrowUp' && atStart && slide.index > 0) {
                    event.preventDefault();
                    focusSlide(slide.index - 1, false);
                    return;
                  }
                  if (event.key === 'ArrowDown' && atEnd && slide.index < presentation.slides.length - 1) {
                    event.preventDefault();
                    focusSlide(slide.index + 1, true);
                    return;
                  }
                }
                handleMarkdownShortcut(event.currentTarget, event);
              }
              : undefined}
            onBlur={(event) => {
              if (editingSource.current?.slideIndex === slide.index) {
                const markdown = serializeSlide(event.currentTarget);
                if (editingSource.current?.slideIndex === slide.index && editingSource.current.markdown !== markdown) {
                  onSourceChange(replaceSlideMarkdown(source, slide.index, markdown));
                }
                editingSource.current = null;
                if (isSlideOverBudget(markdown)) setOverflowPrompt(slide.index);
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
                  data-block-index={blockIndex}
                  key={`preview-${blockIndex}`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setSourceBlock({ slideIndex: slide.index, blockIndex });
                    setSourceDraft(block);
                  }}
                >
                  {(() => {
                    let taskIndex = 0;
                    return (
                      <ReactMarkdown
                        rehypePlugins={[rehypeKatex, preserveRenderedMath]}
                        remarkPlugins={[remarkGfm, remarkMath]}
                        components={{
                          span: ({ className, node: _node, ...props }) => {
                            const classes = Array.isArray(className) ? className.join(' ') : className || '';
                            return classes.includes('katex')
                              ? <span className={className} contentEditable={false} {...props} />
                              : <span className={className} {...props} />;
                          },
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
            )            ) : <h1 className="empty-slide-heading"><br /></h1>}
            <span className="slide-number" contentEditable={false} aria-hidden="true">{slide.index + 1}</span>
          </article>
          {activeSlide === slide.index && (
            <div className="slide-actions" aria-label={`Actions for slide ${slide.index + 1}`}>
              <button
                type="button"
                className="slide-delete-button"
                aria-label={`Delete slide ${slide.index + 1}`}
                onClick={() => {
                  const scrollY = window.scrollY;
                  const replacement = Math.min(slide.index, presentation.slides.length - 2);
                  setUndoDelete({ source, slideIndex: slide.index, scrollY });
                  setSourceBlock(null);
                  setOverflowPrompt(null);
                  changeSlide(replacement < 0 ? 0 : replacement, deleteSlideMarkdown(source, slide.index), true);
                }}
              >Delete slide</button>
            </div>
          )}
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
          <button
            type="button"
            className="slide-add-button"
            onClick={() => {
              setUndoDelete(null);
              changeSlide(slide.index + 1, insertSlideMarkdown(source, slide.index), true);
            }}
          >Add slide</button>
        </div>
      ))}
      {undoDelete && (
        <div className="slide-undo-notice" role="status">
          <span>Slide deleted.</span>
          <button type="button" onClick={() => {
            const restore = undoDelete;
            const deletedSource = deleteSlideMarkdown(restore.source, restore.slideIndex);
            if (source !== deletedSource) {
              setUndoDelete(null);
              return;
            }
            setUndoDelete(null);
            changeSlide(restore.slideIndex, restore.source, false);
            window.scrollTo?.({ top: restore.scrollY, behavior: 'auto' });
          }}>Undo</button>
        </div>
      )}
    </main>
  );
}
