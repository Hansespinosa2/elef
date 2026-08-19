// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { findMathRanges, markdownBlockRanges } from '../../src/components/PresentationEditor';
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

  it('reveals one source line from a clicked paragraph while the rest of the slide stays rendered', () => {
    const markdown = '# One\n\nFirst paragraph line\nContinuation line\n\nNeighboring block';
    render(markdown);
    const paragraph = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${paragraph.from}"]`)!;
    rendered.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 100, bottom: 100, left: 0, width: 100, height: 100,
      toJSON: () => undefined,
    });

    act(() => rendered.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 75 })));

    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('Continuation line');
    const remainingRendered = Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'));
    expect(remainingRendered.some((block) => block.textContent?.includes('First paragraph line'))).toBe(true);
    expect(remainingRendered.some((block) => block.textContent?.includes('Neighboring block'))).toBe(true);
    expect(remainingRendered.some((block) => block.textContent?.includes('One'))).toBe(true);
  });

  it('shows heading syntax only while its source line is active', () => {
    const markdown = 'Intro paragraph\n\n## Heading\n\nAfter heading';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const headingFrom = markdown.indexOf('## Heading');
    const afterFrom = markdown.indexOf('After heading');

    expect(container.querySelector('.cm-content')?.textContent).not.toContain('## Heading');
    act(() => editor.dispatch({ selection: { anchor: headingFrom } }));
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent)).toEqual(['## Heading']);
    expect(container.querySelectorAll('.cm-rendered-block')).toHaveLength(2);

    act(() => editor.dispatch({ selection: { anchor: afterFrom } }));
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('## Heading');
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .some((block) => block.textContent?.includes('Heading'))).toBe(true);
  });

  it('reveals a fenced code block as one coherent source unit', () => {
    const markdown = '# One\n\n```ts\nconst value = 1;\n```\n\nAfter code';
    render(markdown);
    const fence = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${fence.from}"]`)!;

    act(() => rendered.click());

    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent)).toEqual(['```ts', 'const value = 1;', '```']);
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .some((block) => block.textContent?.includes('After code'))).toBe(true);
  });

  it('keeps edits in CodeMirror history while source fragments rerender', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nEditable line\nContinuation line\n\nAfter';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = markdown.indexOf('Editable line');
    act(() => editor.dispatch({ selection: { anchor: from } }));

    act(() => editor.dispatch({ changes: { from, to: from + 'Editable'.length, insert: 'Changed' } }));
    expect(changes.at(-1)).toContain('Changed line');
    act(() => { expect(undo(editor)).toBe(true); });
    expect(editor.state.doc.toString()).toBe(markdown);
    act(() => { expect(redo(editor)).toBe(true); });
    expect(editor.state.doc.toString()).toContain('Changed line');
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

  it('changes a slide layout from the slide controls', () => {
    const changes: string[] = [];
    render('# One\n---\n# Two', (next) => changes.push(next));
    const layout = container.querySelector<HTMLSelectElement>('select[aria-label="Layout for slide 2"]')!;
    act(() => {
      layout.value = 'intro';
      layout.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(changes.at(-1)).toBe('# One\n---\n:::slide-layout{intro}\n# Two');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Layout for slide 2"]')?.value).toBe('intro');
  });

  it('renders an editable surface for empty slides', () => {
    render('');
    expect(container.querySelectorAll('.cm-rendered-block')).toHaveLength(1);
    expect(container.querySelector('.cm-slide-first, .cm-slide-anchor')).not.toBeNull();
  });

  it('hides layout metadata and applies intro layout hooks', () => {
    const changes: string[] = [];
    render(':::slide-layout{intro}\n# Welcome\n\nSubtitle', (source) => changes.push(source));
    expect(container.querySelector('.cm-slide-first[data-slide-layout="intro"]')).not.toBeNull();
    const rendered = container.querySelector<HTMLElement>('.cm-rendered-block')!;
    expect(rendered.textContent).toContain('Welcome');
    expect(rendered.textContent).not.toContain('slide-layout');
  });

  it('preserves layout metadata when source content is edited', () => {
    const changes: string[] = [];
    const source = ':::slide-layout{intro}\n# Welcome';
    render(source, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = source.indexOf('Welcome');
    act(() => editor.dispatch({ changes: { from, to: from + 'Welcome'.length, insert: 'Updated' } }));
    expect(changes.at(-1)).toContain(':::slide-layout{intro}');
    expect(changes.at(-1)).toContain('# Updated');
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

  it('toggles a task marker through the source transaction without exposing the line', () => {
    const changes: string[] = [];
    const source = '# Tasks\n\n- [ ] Ship the editor';
    render(source, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: 0 } }));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      checkbox.click();
    });

    expect(changes.at(-1)).toBe('# Tasks\n\n- [x] Ship the editor');
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('- [ ]');
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .every((line) => !line.textContent?.includes('Ship the editor'))).toBe(true);
  });

  it('keeps overflow inline with a scrollbar and non-blocking warning', () => {
    const source = ['# One', ...Array.from({ length: 40 }, (_, index) => `Line ${index}`)].join('\n');
    render(source);
    const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;

    expect(boundary.querySelector('.cm-slide-overflow-warning')).not.toBeNull();
    expect(getComputedStyle(boundary).overflowY).toBe('visible');
    expect(boundary.querySelector('[role="dialog"]')).toBeNull();
  });

  it('reveals a table as one bounded structured unit', () => {
    const markdown = '# Data\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: 0 } }));
    const table = container.querySelector<HTMLElement>('.cm-rendered-block table')!;
    expect(table).not.toBeNull();

    act(() => table.click());

    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent)).toEqual([
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '| 3 | 4 |',
      ]);
  });

  it('cancels split inspection without changing source, selection, or history', () => {
    const changes: string[] = [];
    const source = ['# One', ...Array.from({ length: 19 }, (_, index) => `Body ${index}`), '## Two', 'More'].join('\n');
    render(source, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: source.indexOf('Body') } }));
    const before = editor.state.selection.main;

    act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.click());
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Cancel')!.click());

    expect(changes).toHaveLength(0);
    expect(editor.state.doc.toString()).toBe(source);
    expect(editor.state.selection.main).toEqual(before);
  });

  it('does not change source when entering and leaving presentation mode', () => {
    const source = '# One\n---\n# Two';
    const changes: string[] = [];
    render(source, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: source.indexOf('# Two') } }));

    act(() => container.querySelector<HTMLButtonElement>('.presentation-editor-toolbar button')?.click());
    expect(container.querySelector('.presentation-playback')).not.toBeNull();
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('.presentation-editor-toolbar button'))
      .find((button) => button.textContent === 'Back to editor')?.click());

    expect(changes).toHaveLength(0);
    expect(editor.state.doc.toString()).toBe(source);
  });

  it('keeps playback separate from the editing authority', () => {
    render('# One\n---\n# Two');
    act(() => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelector('.presentation-playback')).not.toBeNull();
    expect(container.querySelector('.presentation-playback [contenteditable="true"]')).toBeNull();
    expect(container.querySelector('.presentation-live-canvas')?.classList.contains('hidden')).toBe(true);
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
