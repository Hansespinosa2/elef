// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { findMathRanges } from '../../src/components/ObsidianStyleEditor';
import { parseMarkdown } from '../../src/domain/presentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Obsidian-style presentation editor', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
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
  }

  it('creates one CodeMirror document and never makes a rendered slide contentEditable', () => {
    render('# One\n---\n# Two');
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
    expect(container.querySelectorAll('.slide[contenteditable="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.obsidian-slide-page')).toHaveLength(2);
  });

  it('keeps slide controls source-backed and preserves the delimiter', () => {
    const changes: string[] = [];
    render('# One\n---\n# Two', (next) => changes.push(next));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!.click());
    expect(changes.at(-1)).toBe('# One\n---\n\n---\n# Two');
    act(() => root.unmount());
    container.remove();
    const deleted: string[] = [];
    render('# One\n---\n# Two', (next) => deleted.push(next));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 2"]')!.click());
    expect(deleted.at(-1)).toBe('# One');
  });

  it('renders valid inline and display TeX without changing source', () => {
    render('Before $x=3$.\n\n$$\ny = mx + b\n$$');
    expect(container.querySelectorAll('.katex')).not.toHaveLength(0);
    expect(findMathRanges('Before $x=3$.')).toEqual([
      { from: 7, to: 12, source: 'x=3', display: false, valid: true },
    ]);
  });

  it('leaves incomplete or invalid TeX visible with an error state', () => {
    render('Broken $x^2');
    expect(container.querySelector('.slide-invalid-tex')).not.toBeNull();
    expect(container.querySelector('.cm-math-invalid-source')).not.toBeNull();
  });

  it('focuses the continuous document when a visual page is clicked', () => {
    render('# One\n---\n# Two');
    const page = container.querySelectorAll<HTMLElement>('.obsidian-slide-page')[1];
    act(() => page.click());
    expect(container.querySelector('.obsidian-codemirror .cm-content')).not.toBeNull();
  });
});
