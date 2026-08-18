// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PresentationPreview, serializeSlide } from '../../src/components/PresentationPreview';
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

  function render(markdown: string, onSourceChange = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(markdown)}
          theme="light"
          source={markdown}
          onSourceChange={onSourceChange}
        />,
      );
    });
    return container.querySelector<HTMLElement>('.slide')!;
  }

  it('renders Add and Delete controls and sends canonical source updates', () => {
    const changes: string[] = [];
    render('# One\n---\n# Two', (source) => changes.push(source));
    const addButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-add-button'));
    expect(addButtons).toHaveLength(2);
    act(() => addButtons[0].click());
    expect(changes.at(-1)).toBe('# One\n---\n\n---\n# Two');
    act(() => container.querySelector<HTMLButtonElement>('.slide-delete-button')!.click());
    expect(changes.at(-1)).toBe('# One');
    expect(container.querySelector('.slide-undo-notice')).not.toBeNull();
  });

  it('keeps one blank slide after deleting the only slide', () => {
    const changes: string[] = [];
    render('# One', (source) => changes.push(source));
    act(() => container.querySelector<HTMLButtonElement>('.slide-delete-button')!.click());
    expect(changes).toEqual(['']);
    expect(container.querySelector('.slide-undo-notice')).not.toBeNull();
  });

  it('creates a slide when the third dash is typed on an empty line', () => {
    const changes: string[] = [];
    const slide = render('# One', (source) => changes.push(source));
    const paragraph = document.createElement('p');
    const text = document.createTextNode('--');
    paragraph.append(text);
    slide.append(paragraph);
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    act(() => {
      slide.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
    });

    expect(changes.at(-1)).toBe('# One\n---\n');
  });

  it('deletes an empty slide when Backspace is pressed', () => {
    const changes: string[] = [];
    render('# One\n---\n', (source) => changes.push(source));
    const slide = container.querySelectorAll<HTMLElement>('.slide')[1];
    act(() => slide.click());
    act(() => {
      slide.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });
    expect(changes.at(-1)).toBe('# One');
  });

  it('restores the exact source when Undo is activated', () => {
    const changes: string[] = [];
    let currentSource = '# One\n---\n# Two';
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const update = (source: string) => {
      currentSource = source;
      changes.push(source);
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(currentSource)}
          theme="light"
          source={currentSource}
          onSourceChange={update}
        />,
      );
    };
    act(() => {
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(currentSource)}
          theme="light"
          source={currentSource}
          onSourceChange={update}
        />,
      );
    });
    act(() => container.querySelectorAll<HTMLElement>('.slide')[1].click());
    act(() => container.querySelector<HTMLButtonElement>('.slide-delete-button')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.slide-undo-notice button')!.click());
    expect(changes).toEqual(['# One', '# One\n---\n# Two']);
  });

  it('keeps source and rendered slides coherent across rapid parent rerenders', () => {
    let currentSource = '# One';
    const update = (source: string) => {
      currentSource = source;
      act(() => {
        root.render(
          <PresentationPreview
            presentation={parseMarkdown(currentSource)}
            theme="light"
            source={currentSource}
            onSourceChange={update}
          />,
        );
      });
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(currentSource)}
          theme="light"
          source={currentSource}
          onSourceChange={update}
        />,
      );
    });
    act(() => container.querySelector<HTMLButtonElement>('.slide-add-button')!.click());
    act(() => container.querySelectorAll<HTMLButtonElement>('.slide-add-button')[1].click());
    expect(currentSource).toBe('# One\n---\n\n---\n');
    expect(container.querySelectorAll('.slide')).toHaveLength(3);
  });

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
    const slide = render('How does TeX work? $x=3$.');
    act(() => {
      slide.querySelector<HTMLElement>('.slide-preview-block')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(slide.querySelector('textarea')?.value).toContain('$x=3$');
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

  it('moves the caret across slide boundaries with Up and Down', () => {
    const slide = render('# One\n---\n# Two');
    const slides = container.querySelectorAll<HTMLElement>('.slide');
    const secondHeading = slides[1].querySelector('h1')!.firstChild!;
    const start = document.createRange();
    start.setStart(secondHeading, 0);
    start.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(start);

    act(() => {
      slides[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(slides[0].classList.contains('editing')).toBe(true);

    const firstHeading = slides[0].querySelector('h1')!.firstChild!;
    const end = document.createRange();
    end.setStart(firstHeading, firstHeading.textContent?.length ?? 0);
    end.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(end);

    act(() => {
      slides[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(slides[1].classList.contains('editing')).toBe(true);
  });

  it('preserves inline and display math when preview content is serialized', () => {
    const markdown = 'Before $x=3$.\n\n$$\ny = mx + b\n$$\n\nAfter.';
    const slide = render(markdown);
    expect(serializeSlide(slide)).toContain('$x=3$');
    expect(serializeSlide(slide)).toContain('$$\ny = mx + b\n$$');
  });
});
