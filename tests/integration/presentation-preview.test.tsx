// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { parseMarkdown } from '../../src/domain/presentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PresentationPreview interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.useRealTimers();
  });

  function render(markdown: string) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(markdown)}
          theme="light"
          source={markdown}
          onSourceChange={() => undefined}
        />,
      );
    });
    return container.querySelector<HTMLElement>('.slide')!;
  }

  it('activates inline editing from a single click', () => {
    vi.useFakeTimers();
    const slide = render('# Heading');
    act(() => {
      slide.click();
      vi.advanceTimersByTime(180);
    });
    expect(slide.getAttribute('contenteditable')).toBe('true');
  });

  it('exits contextual source mode when clicking outside the active block', () => {
    const slide = render('# Heading\n\nBody');
    const block = slide.querySelector<HTMLElement>('.slide-preview-block')!;
    act(() => {
      block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(slide.querySelector('textarea')).not.toBeNull();

    act(() => {
      slide.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(slide.querySelector('textarea')).toBeNull();
  });

  it('turns an empty list item into a normal paragraph', () => {
    vi.useFakeTimers();
    const slide = render('- one\n- ');
    act(() => {
      slide.click();
      vi.advanceTimersByTime(180);
    });
    const emptyItem = slide.querySelectorAll('li')[1];
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(emptyItem);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      slide.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(slide.querySelectorAll('li')).toHaveLength(1);
    expect(slide.querySelector('ul + p')).not.toBeNull();
  });

  it('renders inline math as KaTeX', () => {
    const slide = render('How does TeX work? $x=3$.');
    expect(slide.querySelector('.katex')).not.toBeNull();
  });

  it('reveals math source while inline editing', () => {
    vi.useFakeTimers();
    const slide = render('How does TeX work? $x=3$.');
    act(() => {
      slide.querySelector<HTMLElement>('.slide-preview-block')!.click();
      vi.advanceTimersByTime(180);
    });
    expect(slide.querySelector('.katex')).toBeNull();
    expect(slide.textContent).toContain('$x=3$');
  });

  it('restores rendered math when focus moves to another block', () => {
    vi.useFakeTimers();
    const slide = render('$x=3$\n\nA separate paragraph.');
    const blocks = slide.querySelectorAll<HTMLElement>('.slide-preview-block');
    act(() => {
      blocks[0].click();
      vi.advanceTimersByTime(180);
    });
    expect(blocks[0].querySelector('.katex')).toBeNull();
    act(() => {
      blocks[1].click();
    });
    expect(blocks[0].querySelector('.katex')).not.toBeNull();
  });

  it('opens the active block source with Command-Enter', () => {
    vi.useFakeTimers();
    const slide = render('A paragraph.\n\n$x=3$');
    const block = slide.querySelector<HTMLElement>('.slide-preview-block')!;
    act(() => {
      block.click();
      vi.advanceTimersByTime(180);
    });
    act(() => {
      block.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
      }));
    });
    expect(slide.querySelector('textarea')?.value).toBe('A paragraph.');
  });

  it('does not override the native caret position within a line', () => {
    const slide = render('A paragraph.');
    const block = slide.querySelector<HTMLElement>('.slide-preview-block')!;
    const text = block.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    act(() => {
      block.click();
    });

    expect(slide.getAttribute('contenteditable')).toBe('true');
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });
});
