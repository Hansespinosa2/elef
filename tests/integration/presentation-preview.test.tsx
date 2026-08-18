// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { findMathRanges, markdownBlockRanges } from '../../src/components/ObsidianStyleEditor';
import { parseMarkdown, slideSourceRanges } from '../../src/domain/presentation';

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

  it('uses one CodeMirror live-preview canvas with no separate source panel', () => {
    render('# One\n\nFirst body\n---\n# Two');
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
    expect(container.querySelectorAll('.slide[contenteditable="true"]')).toHaveLength(0);
    expect(container.querySelector('.obsidian-source-panel')).toBeNull();
    expect(container.querySelector('.obsidian-editor-pages')).toBeNull();
    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(2);
    expect(container.querySelectorAll('.cm-rendered-block')).not.toHaveLength(0);
  });

  it('presents blocks as members of coherent fixed slide surfaces', () => {
    render('# One\n\nFirst body\n---\n# Two\n\nSecond body');
    const surfaces = Array.from(container.querySelectorAll<HTMLElement>('.cm-slide-first'));
    expect(surfaces).toHaveLength(2);
    expect(surfaces.map((surface) => surface.dataset.slideLabel)).toEqual(['Slide 1', 'Slide 2']);

    const renderedBlocks = Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'));
    expect(renderedBlocks.length).toBeGreaterThanOrEqual(2);
    expect(renderedBlocks.every((block) => block.dataset.slideSurface === block.dataset.slideIndex)).toBe(true);
    expect(container.querySelectorAll('.cm-slide-boundary')).toHaveLength(2);
    expect(container.querySelectorAll('.cm-slide-page-fill')).toHaveLength(2);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    expect(editor.state.doc.toString()).toContain('\n---\n');
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('---');
  });

  it('keeps the continuous editor and slide surfaces free of nested scrollbars', () => {
    render('# One\n\nBody\n---\n# Two');
    const scroller = container.querySelector<HTMLElement>('.cm-scroller')!;
    expect(getComputedStyle(scroller).overflow).toBe('visible');
    expect(container.querySelectorAll('.cm-slide-first .cm-scroller')).toHaveLength(0);
    expect(container.querySelectorAll('.cm-slide-first [style*="overflow"]')).toHaveLength(0);
  });

  it('keeps front matter out of the rendered slide canvas', () => {
    const source = '---\npresentationTheme: light\n---\n# One';
    expect(slideSourceRanges(source)[0]?.start).toBeGreaterThan(0);
    render(source);
    expect(container.querySelector('.cm-frontmatter-widget')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('.cm-line')).map((line) => line.textContent)).not.toContain('presentationTheme: light');
    expect(container.querySelector('.cm-line')?.textContent).toContain('# One');
  });

  it('reveals compact front matter as settings source without turning it into a slide', () => {
    render('---\npresentationTheme: light\n---\n# One');
    const settings = container.querySelector<HTMLButtonElement>('.cm-frontmatter-widget')!;
    act(() => settings.click());

    const metadataLines = Array.from(container.querySelectorAll<HTMLElement>('.cm-frontmatter-line'));
    expect(metadataLines.map((line) => line.textContent)).toContain('presentationTheme: light');
    expect(metadataLines.every((line) => !line.classList.contains('cm-slide-line'))).toBe(true);
    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(1);
    expect(container.querySelector('.cm-frontmatter-widget')).toBeNull();
  });

  it('reveals only the clicked rendered Markdown block in the CodeMirror canvas', () => {
    const markdown = '# One\n\nSecond paragraph\n\nThird paragraph';
    render(markdown);
    const secondBlock = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${secondBlock.from}"]`)!;
    expect(rendered.textContent).toContain('Second paragraph');

    act(() => rendered.click());

    const sourceLines = Array.from(container.querySelectorAll<HTMLElement>('.cm-line'))
      .map((line) => line.textContent);
    expect(sourceLines).toContain('Second paragraph');
    expect(container.querySelector(`[data-block-from="${secondBlock.from}"]`)).toBeNull();
    expect(container.querySelectorAll('.cm-rendered-block')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent)).toContain('Second paragraph');
    expect(container.querySelectorAll('.cm-source-revealed')).toHaveLength(1);
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

  it('reveals clicked math source and selects its exact range on double-click', () => {
    const markdown = '# Intro\n\nMath $x=3$ here.';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = markdown.indexOf('$x=3$');
    const math = container.querySelector<HTMLElement>('.cm-rendered-block .katex')!;

    act(() => math.click());
    expect(editor.state.selection.main).toMatchObject({ from, to: from });
    expect(container.querySelector('.cm-content')?.textContent).toContain('Math $x=3$ here.');

    act(() => editor.dispatch({ selection: { anchor: 0 } }));
    const renderedAgain = container.querySelector<HTMLElement>('.cm-rendered-block .katex')!;
    act(() => renderedAgain.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(editor.state.selection.main).toMatchObject({ from, to: from + '$x=3$'.length });
  });

  it('leaves incomplete or invalid TeX visible with an error state', () => {
    render('Broken $x^2');
    expect(container.querySelector('.cm-math-invalid-source')).not.toBeNull();
    expect(container.querySelector('.cm-content')?.textContent).toContain('Broken $x^2');
  });

  it('keeps playback separate from the editing authority', () => {
    render('# One\n---\n# Two');
    act(() => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelector('.presentation-playback')).not.toBeNull();
    expect(container.querySelector('.presentation-playback [contenteditable="true"]')).toBeNull();
    expect(container.querySelector('.obsidian-live-canvas')?.classList.contains('hidden')).toBe(true);
  });

  it('previews an automatic split without changing source, then supports confirmation and undo', () => {
    const changes: string[] = [];
    const overflowing = ['# One', ...Array.from({ length: 19 }, (_, index) => `Line ${index}`), '## Two', 'Ending'].join('\n');
    render(overflowing, (next) => changes.push(next));
    const preview = container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!;
    expect(preview).not.toBeNull();
    expect(container.querySelector('.cm-slide-boundary.may-overflow')).not.toBeNull();

    act(() => preview.click());
    expect(changes).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('has not changed');

    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Confirm split')!.click());
    expect(changes.at(-1)).toContain('\n---\n## Two');

    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-undo-notice button'))[0].click());
    expect(changes.at(-1)).toBe(overflowing);
  });
});
