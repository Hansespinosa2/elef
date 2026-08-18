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
import { ObsidianStyleEditor } from './ObsidianStyleEditor';
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

function moveCaretToVisualLineEnd(block: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode) return false;
  const current = document.createRange();
  current.setStart(selection.anchorNode, selection.anchorOffset);
  current.collapse(true);
  if (typeof current.getBoundingClientRect !== 'function') return false;
  const caretRect = current.getBoundingClientRect();
  if (!caretRect.height && !caretRect.bottom) return false;
  const lineTolerance = Math.max(1, caretRect.height / 2);
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let target: { node: Text; offset: number; rect: DOMRect } | null = null;
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    for (let offset = 0; offset <= text.length; offset += 1) {
      const candidate = document.createRange();
      candidate.setStart(text, offset);
      candidate.collapse(true);
      if (typeof candidate.getBoundingClientRect !== 'function') continue;
      const rect = candidate.getBoundingClientRect();
      if (!rect.height || Math.abs(rect.top - caretRect.top) > lineTolerance) continue;
      if (!target || rect.left > target.rect.left || (rect.left === target.rect.left && offset > target.offset)) {
        target = { node: text, offset, rect };
      }
    }
    node = walker.nextNode();
  }
  if (!target || (target.node === selection.anchorNode && target.offset === selection.anchorOffset)) return false;
  const remaining = document.createRange();
  remaining.selectNodeContents(block);
  remaining.setStart(target.node, target.offset);
  if (!remaining.toString().trim()) {
    placeCaretAtBlockBoundary(block, false);
    return true;
  }
  const next = document.createRange();
  next.setStart(target.node, target.offset);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
}

function moveCaretByVisualLine(block: HTMLElement, direction: -1 | 1): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode) return false;
  const current = document.createRange();
  current.setStart(selection.anchorNode, selection.anchorOffset);
  current.collapse(true);
  if (typeof current.getBoundingClientRect !== 'function') return false;
  const caretRect = current.getBoundingClientRect();
  if (!caretRect.height && !caretRect.bottom) return false;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const candidates: Array<{ node: Text; offset: number; rect: DOMRect }> = [];
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    for (let offset = 0; offset <= text.length; offset += 1) {
      const candidate = document.createRange();
      candidate.setStart(text, offset);
      candidate.collapse(true);
      if (typeof candidate.getBoundingClientRect !== 'function') continue;
      const rect = candidate.getBoundingClientRect();
      const onTargetLine = direction > 0
        ? rect.top > caretRect.top + caretRect.height / 2
        : rect.bottom < caretRect.bottom - caretRect.height / 2;
      if (onTargetLine && rect.height) candidates.push({ node: text, offset, rect });
    }
    node = walker.nextNode();
  }
  if (!candidates.length) return false;
  const targetLine = direction > 0
    ? Math.min(...candidates.map(({ rect }) => rect.top))
    : Math.max(...candidates.map(({ rect }) => rect.bottom));
  const target = candidates
    .filter(({ rect }) => (direction > 0 ? rect.top : rect.bottom) === targetLine)
    .sort((left, right) => Math.abs(left.rect.left - caretRect.left) - Math.abs(right.rect.left - caretRect.left))[0];
  if (!target) return false;
  const next = document.createRange();
  next.setStart(target.node, target.offset);
  next.collapse(true);
  selection.removeAllRanges();
  selection.addRange(next);
  return true;
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

export function PresentationPreview(props: Props) {
  return <ObsidianStyleEditor {...props} />;
}
