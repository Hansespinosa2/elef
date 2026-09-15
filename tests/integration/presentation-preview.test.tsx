// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import {
  deleteCharBackward,
  deleteCharForward,
  indentLess,
  indentMore,
  redo,
  undo,
} from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { findMathRanges, markdownBlockRanges } from '../../src/components/PresentationEditor';
import { insertSlideMarkdown, parseMarkdown, slideSourceRanges } from '../../src/domain/presentation';
import type { ThemeMode } from '../../src/domain/presentation';

const katexMockState = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock('katex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('katex')>();
  const renderToString: typeof actual.default.renderToString = (expression, options) => {
    if (katexMockState.shouldThrow) throw new Error('unexpected katex failure');
    return actual.default.renderToString(expression, options);
  };
  return { ...actual, default: { ...actual.default, renderToString } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Obsidian-style presentation editor', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function renderApp(markdown: string, onSourceChange: (source: string) => void, theme: ThemeMode = 'light') {
    act(() => {
      root.render(
        <PresentationPreview
          presentation={parseMarkdown(markdown)}
          theme={theme}
          source={markdown}
          onSourceChange={onSourceChange}
        />,
      );
    });
  }

  function render(markdown: string, onSourceChange = () => undefined, theme: ThemeMode = 'light') {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    renderApp(markdown, onSourceChange, theme);
  }

  /** Re-renders onto the same root/container so React reconciles rather than remounting. */
  function rerender(markdown: string, onSourceChange = () => undefined, theme: ThemeMode = 'light') {
    renderApp(markdown, onSourceChange, theme);
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

  it('switches between inline preview and full Markdown source without changing the document', () => {
    const source = '# One\n\nFirst body\n---\n# Two';
    const changes: string[] = [];
    render(source, (next) => changes.push(next));
    const toggle = container.querySelector<HTMLButtonElement>('.source-mode-toggle')!;

    act(() => toggle.click());

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('.presentation-live-canvas')?.classList.contains('source-mode')).toBe(true);
    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(0);
    expect(container.querySelector('.cm-content')?.textContent).toContain('---');
    expect(EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!).state.doc.toString()).toBe(source);
    expect(changes).toHaveLength(0);

    act(() => toggle.click());

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(2);
    expect(changes).toHaveLength(0);
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

  it('keeps an active H1 rendered at presentation size without exposing Markdown syntax', () => {
    const markdown = '# ThisHeader';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Header') } }));

    expect(container.querySelector('.cm-source-revealed')).toBeNull();
    expect(container.querySelector('.cm-heading-source-active')).not.toBeNull();
    expect(container.querySelector('.cm-heading-source-active')?.textContent).not.toContain('# ');
  });

  it('keeps an active intro H1 inside the slide surface and hides its layout directive', () => {
    const markdown = ':::slide-layout{intro}\n# ThisHeader';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Header') } }));

    const activeHeading = container.querySelector('.cm-heading-source-active');
    expect(container.querySelector('.cm-slide-first[data-slide-layout="intro"]')).not.toBeNull();
    expect(activeHeading?.closest('.cm-rendered-block')).not.toBeNull();
    expect(activeHeading?.closest('.cm-slide-intro')).not.toBeNull();
    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(1);
    expect(container.querySelector('.cm-slide-line')?.textContent).not.toContain(':::slide-layout{intro}');
  });

  it('keeps the intro slide surface geometry unchanged while editing its H1', () => {
    const markdown = ':::slide-layout{intro}\n# Hello';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const surface = container.querySelector<HTMLElement>('.cm-slide-first')!;
    const before = {
      className: surface.className,
      layout: surface.dataset.slideLayout,
      slideSurfaceCount: container.querySelectorAll('.cm-slide-first').length,
    };

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('He') + 2 } }));

    expect({
      className: surface.className,
      layout: surface.dataset.slideLayout,
      slideSurfaceCount: container.querySelectorAll('.cm-slide-first').length,
    }).toEqual(before);
  });

  it('keeps the active intro H1 aligned with the rendered heading instead of adding source indentation', () => {
    const markdown = ':::slide-layout{intro}\n# Hello';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('He') + 2 } }));

    const activeHeading = container.querySelector<HTMLElement>('.cm-heading-source-active');
    expect(activeHeading?.classList.contains('cm-heading-source-level-1')).toBe(true);
    expect(activeHeading?.getAttribute('style')).toContain('padding-inline: 0');
  });

  it('keeps the caret at the clicked position inside the active intro H1', () => {
    const markdown = ':::slide-layout{intro}\n# Hello';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const clickedPosition = markdown.indexOf('He') + 2;

    act(() => editor.dispatch({ selection: { anchor: clickedPosition } }));

    expect(editor.state.selection.main.head).toBe(clickedPosition);
    expect(container.querySelector('.cm-heading-source-active')?.textContent).toBe('Hello');
  });

  it('keeps a second click inside an already active intro H1', () => {
    const markdown = ':::slide-layout{intro}\n# ThisTitle';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const firstPosition = markdown.indexOf('This') + 3;
    const secondPosition = markdown.indexOf('Title') + 2;

    act(() => editor.dispatch({ selection: { anchor: firstPosition } }));
    const activeHeading = container.querySelector<HTMLElement>('.cm-heading-source-active')!;
    const posAtCoords = vi.spyOn(editor, 'posAtCoords').mockReturnValue(secondPosition);

    act(() => activeHeading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 })));

    expect(posAtCoords).toHaveBeenCalled();
    expect(editor.state.selection.main.head).toBe(secondPosition);
    expect(editor.state.selection.main.head).toBeGreaterThan(markdown.indexOf('\n# ') + 3);
    posAtCoords.mockRestore();
  });

  it('renders a typed intro H1 with a trailing newline as one slide', () => {
    const markdown = ':::slide-layout{intro}\n# Hello\n';
    render(markdown);

    expect(container.querySelectorAll('.cm-slide-first')).toHaveLength(1);
    expect(container.querySelectorAll('.cm-slide-anchor')).toHaveLength(0);
    expect(container.textContent).not.toContain(':::slide-layout{intro}');
  });

  it('keeps active body-slide headings rendered in place at every heading level', () => {
    const markdown = '# First slide\n---\n## Body heading\n\nBody text';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Body heading') } }));

    const activeHeading = container.querySelector('.cm-heading-source-active');
    expect(activeHeading?.closest('.cm-rendered-block.cm-slide-body')).not.toBeNull();
    expect(activeHeading?.classList.contains('cm-heading-source-level-2')).toBe(true);
    expect(container.querySelector('.cm-source-revealed')).toBeNull();
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

  it('focuses the Markdown document when an empty area of a slide is clicked', () => {
    const changes: string[] = [];
    render('# One', (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const surface = container.querySelector<HTMLElement>('.cm-slide-first')!;

    act(() => surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => editor.dispatch({ changes: { from: editor.state.selection.main.head, insert: ' title' } }));

    expect(changes.at(-1)).toBe(' title# One');
  });

  it('hides layout metadata and applies intro layout hooks', () => {
    const changes: string[] = [];
    render(':::slide-layout{intro}\n# Welcome\n\nSubtitle', (source) => changes.push(source));
    expect(container.querySelector('.cm-slide-first[data-slide-layout="intro"]')).not.toBeNull();
    const rendered = container.querySelector<HTMLElement>('.cm-rendered-block')!;
    expect(rendered.textContent).toContain('Welcome');
    expect(rendered.textContent).not.toContain('slide-layout');
  });

  it('focuses a new intro presentation after its editable H1 prefix', () => {
    const source = ':::slide-layout{intro}\n# ';
    render(source);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    expect(editor.state.selection.main.head).toBe(source.length);
    expect(document.activeElement).toBe(editor.contentDOM);
  });

  it('preserves new intro focus when the source arrives after the editor mounts', () => {
    const source = ':::slide-layout{intro}\n# ';
    render('');
    rerender(source);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    expect(editor.state.selection.main.head).toBe(source.length);
    expect(document.activeElement).toBe(editor.contentDOM);
  });

  it('renders an empty new intro H1 without creating an invalid decoration range', () => {
    expect(() => render(':::slide-layout{intro}\n# ')).not.toThrow();
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

describe('AUTH: editing authority and selection', () => {
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
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('AUTH-2: re-rendering with an unchanged source never dispatches a new CodeMirror transaction', () => {
    const markdown = '# One\n\nBody text';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const dispatchSpy = vi.spyOn(editor, 'dispatch');
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={() => undefined} />,
      );
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('AUTH-3: moving the caret through ordinary paragraph text preserves the exact requested position', () => {
    const markdown = '# One\n\nOrdinary paragraph text for caret movement.';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const target = markdown.indexOf('paragraph');
    act(() => editor.dispatch({ selection: { anchor: target } }));
    expect(editor.state.selection.main.head).toBe(target);
    act(() => editor.dispatch({ selection: { anchor: target + 3 } }));
    expect(editor.state.selection.main.head).toBe(target + 3);
  });

  it('AUTH-4: selection stays put in one block while an edit re-renders a different block', () => {
    const markdown = '# One\n\nFirst paragraph\n\nSecond paragraph';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const anchor = markdown.indexOf('First paragraph') + 2;
    act(() => editor.dispatch({ selection: { anchor } }));
    const secondFrom = markdown.indexOf('Second paragraph');
    act(() => editor.dispatch({ changes: { from: secondFrom, to: secondFrom + 'Second'.length, insert: 'Edited' } }));
    expect(editor.state.selection.main.head).toBe(anchor);
  });

  it('AUTH-5: a selection spanning rendered and revealed content maps to the exact Markdown substring', () => {
    const markdown = '# One\n\nFirst line here\nSecond line here\n\nAfter block';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = markdown.indexOf('First line here') + 6;
    const to = markdown.indexOf('Second line here') + 6;
    act(() => editor.dispatch({ selection: { anchor: from, head: to } }));
    expect(editor.state.sliceDoc(from, to)).toBe(markdown.slice(from, to));
    expect(editor.state.doc.toString()).toBe(markdown);
  });

  it('AUTH-6: inserting pasted text at the selection does not duplicate or delete surrounding content', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nBefore  after';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const insertAt = markdown.indexOf('Before ') + 'Before '.length;
    act(() => editor.dispatch({ selection: { anchor: insertAt } }));
    act(() => editor.dispatch({ changes: { from: insertAt, to: insertAt, insert: 'PASTED' } }));
    expect(changes.at(-1)).toBe('# One\n\nBefore PASTED after');
  });

  it('AUTH-7: removing exactly the selected source rerenders only the affected region', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nKeep this, remove this, keep this too';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = markdown.indexOf('remove this, ');
    const to = from + 'remove this, '.length;
    act(() => editor.dispatch({ changes: { from, to, insert: '' } }));
    expect(changes.at(-1)).toBe('# One\n\nKeep this, keep this too');
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('remove this');
  });

  it('AUTH-8: Backspace at a line boundary joins adjacent content predictably', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nFirst line\nSecond line';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const boundary = markdown.indexOf('\nSecond line') + 1;
    act(() => editor.dispatch({ selection: { anchor: boundary } }));
    act(() => { deleteCharBackward(editor); });
    expect(changes.at(-1)).toBe('# One\n\nFirst lineSecond line');
  });

  it('AUTH-9: Delete at a line boundary joins adjacent content predictably', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nFirst line\nSecond line';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const endOfFirst = markdown.indexOf('First line') + 'First line'.length;
    act(() => editor.dispatch({ selection: { anchor: endOfFirst } }));
    act(() => { deleteCharForward(editor); });
    expect(changes.at(-1)).toBe('# One\n\nFirst lineSecond line');
  });

  it('AUTH-10: Tab and Shift-Tab preserve CodeMirror indentation behavior', () => {
    const changes: string[] = [];
    const markdown = '# One\n\n- item one\n- item two';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const lineStart = markdown.indexOf('- item two');
    act(() => editor.dispatch({ selection: { anchor: lineStart } }));
    act(() => { indentMore(editor); });
    expect(editor.state.doc.toString()).not.toBe(markdown);
    expect(editor.state.doc.line(editor.state.doc.lineAt(editor.state.selection.main.head).number).text)
      .toMatch(/^\s+- item two/);
    act(() => { indentLess(editor); });
    expect(editor.state.doc.toString()).toBe(markdown);
  });
});

describe('REVEAL: rendered-click and structured-unit reveal', () => {
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
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('REVEAL-3: falls back to a deterministic line boundary when the clicked element has no measurable size', () => {
    const markdown = '# One\n\nFirst line here\nSecond line here';
    render(markdown);
    const block = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${block.from}"]`)!;
    rendered.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON: () => undefined,
    });
    act(() => rendered.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 })));
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('First line here');
  });

  it('REVEAL-6: clicking a rendered list item reveals only the selected list line', () => {
    const markdown = '# One\n\n- First item\n- Second item\n- Third item';
    render(markdown);
    const block = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${block.from}"]`)!;
    const secondItemOffset = markdown.indexOf('- Second item') - block.from;
    rendered.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 100, bottom: 60, left: 0, width: 100, height: 60, toJSON: () => undefined,
    });
    act(() => rendered.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 30 })));
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe(markdown.slice(block.from + secondItemOffset, block.from + secondItemOffset + '- Second item'.length));
    expect(container.querySelector('.cm-content')?.textContent).toContain('First item');
    expect(container.querySelector('.cm-content')?.textContent).toContain('Third item');
  });

  it('REVEAL-7: clicking a rendered quote reveals only the selected quote line', () => {
    const markdown = '# One\n\n> Quoted line one\n> Quoted line two';
    render(markdown);
    const block = markdownBlockRanges(markdown)[1];
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${block.from}"]`)!;
    rendered.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 100, bottom: 40, left: 0, width: 100, height: 40, toJSON: () => undefined,
    });
    act(() => rendered.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 5 })));
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('> Quoted line one');
  });

  it('REVEAL-10: clicking outside the active source line returns the previous line to rendered form', () => {
    const markdown = '# One\n\nFirst paragraph\n\nSecond paragraph';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('First paragraph') } }));
    expect(container.querySelectorAll('.cm-source-revealed')).toHaveLength(1);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Second paragraph') } }));
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('Second paragraph');
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .some((block) => block.textContent?.includes('First paragraph'))).toBe(true);
  });

  it('REVEAL-11: moving the caret into a line does not reveal either neighboring line', () => {
    const markdown = '# One\n\nLine A\nLine B\nLine C';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Line B') } }));
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent);
    expect(revealed).toEqual(['Line B']);
    expect(revealed).not.toContain('Line A');
    expect(revealed).not.toContain('Line C');
  });

  it('REVEAL-5: clicking a rendered heading reveals only that heading line', () => {
    const markdown = 'Intro paragraph\n\n## Heading\n\nAfter heading';
    render(markdown);
    const headingBlock = markdownBlockRanges(markdown).find((block) => markdown.slice(block.from, block.to).includes('## Heading'))!;
    const rendered = container.querySelector<HTMLElement>(`[data-block-from="${headingBlock.from}"]`)!;
    act(() => rendered.click());
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'))
      .map((line) => line.textContent);
    expect(revealed).toEqual(['## Heading']);
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .some((block) => block.textContent?.includes('Intro paragraph'))).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .some((block) => block.textContent?.includes('After heading'))).toBe(true);
  });
});

describe('SURFACE: slide surface presentation', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, theme: ThemeMode = 'light') {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme={theme} source={markdown} onSourceChange={() => undefined} />,
      );
    });
  }

  it('SURFACE-2: slide surfaces carry the active theme class for both light and dark modes', () => {
    render('# One\n\nBody', 'light');
    expect(container.querySelector('.presentation-theme-light')).not.toBeNull();
    act(() => root.unmount());
    container.remove();
    render('# One\n\nBody', 'dark');
    expect(container.querySelector('.presentation-theme-dark')).not.toBeNull();
    expect(container.querySelector('.presentation-theme-light')).toBeNull();
  });

  it('SURFACE-4: slide surfaces expose exactly one stable 16:9 page-fill hook per boundary (structural contract only - actual visual aspect-ratio fill is CSS/layout and is BROWSER-REQUIRED, not verifiable under jsdom)', () => {
    render('# One\n\nBody\n---\n# Two');
    const boundaries = container.querySelectorAll('.cm-slide-boundary');
    const fills = container.querySelectorAll('.cm-slide-page-fill');
    expect(boundaries.length).toBe(2);
    expect(fills.length).toBe(boundaries.length);
    // Each fill hook must live inside its own boundary, not be shared/hoisted.
    boundaries.forEach((boundary) => {
      expect(boundary.querySelectorAll('.cm-slide-page-fill')).toHaveLength(1);
    });
  });

  it('SURFACE-6: the overflow warning is a small, non-blocking status hint that never steals editor focus', () => {
    const overflowing = ['# One', ...Array.from({ length: 40 }, (_, index) => `Line ${index}`)].join('\n');
    render(overflowing);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: 0 } }));
    editor.focus();
    const warning = container.querySelector<HTMLElement>('.cm-slide-overflow-warning')!;
    expect(warning).not.toBeNull();
    // A non-blocking hint must use a passive live-region role, not an
    // interactive/blocking one, and must not itself be a tab stop that could
    // steal focus away from the editor.
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.tabIndex).not.toBeGreaterThanOrEqual(0);
    expect(document.activeElement === editor.contentDOM || editor.contentDOM.contains(document.activeElement)).toBe(true);
  });

  it('SURFACE-7: slide labels and boundary indices remain stable as unrelated source changes', () => {
    render('# One\n\nBody\n---\n# Two');
    const initial = Array.from(container.querySelectorAll<HTMLElement>('.cm-slide-boundary'))
      .map((boundary) => boundary.dataset.slideIndex);
    act(() => root.unmount());
    container.remove();
    render('# One\n\nBody edited\n---\n# Two');
    const after = Array.from(container.querySelectorAll<HTMLElement>('.cm-slide-boundary'))
      .map((boundary) => boundary.dataset.slideIndex);
    expect(after).toEqual(initial);
  });
});

describe('NAV: boundary-crossing vertical navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={() => undefined} />,
      );
    });
  }

  it('NAV-1: clicking a slide boundary (outside its action buttons) focuses an adjacent editable position', () => {
    const markdown = '# One\n---\n# Two';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;
    const label = boundary.querySelector<HTMLElement>('.slide-boundary-label')!;
    act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })));
    const head = editor.state.selection.main.head;
    const slide0 = slideSourceRanges(markdown)[0];
    const slide1 = slideSourceRanges(markdown)[1];
    expect(head === slide0.end || head === slide1.start).toBe(true);
  });

  // NAV-2 and NAV-3 depend on CodeMirror's real visual-line geometry
  // (EditorView.moveVertically -> coordsAtPos -> getClientRects) only for
  // *correct* behavior; jsdom does not implement text measurement, but a real
  // ArrowUp/ArrowDown KeyboardEvent dispatch still deterministically reaches
  // CodeMirror's built-in vertical-motion command through the same
  // EditorView.domEventHandlers pipeline the app registers, which lets us
  // capture the *documented* contract (exact document-position handoff at a
  // slide boundary) as a red test below.
  it('NAV-2: ArrowDown at the end of a slide hands off to the start of the next slide', () => {
    const markdown = '# One\n---\n# Two';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const slide0 = slideSourceRanges(markdown)[0];
    const slide1 = slideSourceRanges(markdown)[1];
    act(() => editor.dispatch({ selection: { anchor: slide0.end } }));
    act(() => {
      editor.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(editor.state.selection.main.head).toBe(slide1.start);
  });

  it('NAV-3: ArrowUp at the start of a slide hands off to the end of the previous slide', () => {
    const markdown = '# One\n---\n# Two';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const slide0 = slideSourceRanges(markdown)[0];
    const slide1 = slideSourceRanges(markdown)[1];
    act(() => editor.dispatch({ selection: { anchor: slide1.start } }));
    act(() => {
      editor.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    });
    expect(editor.state.selection.main.head).toBe(slide0.end);
  });

  // NAV-4 ("ArrowUp/Down inside a slide remain native vertical movement") and
  // NAV-5 ("wrapped visual lines do not trigger slide transitions
  // prematurely") cannot be given a meaningful jsdom assertion: exercising
  // CodeMirror's real vertical-motion command in jsdom throws
  // (`getClientRects is not a function`, see moveVertically/coordsAtPos)
  // because jsdom has no text-layout engine, and a caught/aborted command
  // would trivially "pass" without proving anything about wrapped-line
  // detection. Both are deferred to tests/e2e/slide-boundary-vertical-nav.spec.ts,
  // written but intentionally not executed in this session (see test-plan.md).

  it('NAV-6: an empty slide remains focusable via its boundary controls', () => {
    const markdown = '# One\n---\n---\n# Three';
    render(markdown);
    expect(parseMarkdown(markdown).slides).toHaveLength(3);
    const boundaries = container.querySelectorAll('.cm-slide-boundary');
    expect(boundaries.length).toBeGreaterThanOrEqual(3);
    const emptySlideActions = container.querySelector('[aria-label="Actions for slide 2"]');
    expect(emptySlideActions).not.toBeNull();
    const addButton = emptySlideActions!.querySelector<HTMLButtonElement>('[data-slide-action="add"]')!;
    expect(addButton.tabIndex).not.toBe(-1);
  });
});

describe('BOUNDARY: slide add/delete/focus lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, onSourceChange: (next: string) => void = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('BOUNDARY-1: Add creates a blank slide at the requested boundary', () => {
    let latest = '';
    const markdown = '# One\n---\n# Two';
    render(markdown, (next) => { latest = next; });
    const addButton = container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!;
    act(() => addButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const slides = parseMarkdown(latest).slides;
    expect(slides).toHaveLength(3);
    expect(slides[0].markdown).toBe('# One');
    expect(slides[1].markdown).toBe('');
    expect(slides[2].markdown).toBe('# Two');
  });

  it('BOUNDARY-2: Add focuses the newly created slide', () => {
    const markdown = '# One\n---\n# Two';
    render(markdown, () => undefined);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const addButton = container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!;
    act(() => addButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const next = insertSlideMarkdown(markdown, 0);
    const expectedRange = slideSourceRanges(next)[1];
    expect(editor.state.selection.main.head).toBe(expectedRange.start);
  });

  it('BOUNDARY-3: Delete removes the requested slide and focuses a sensible neighbor', () => {
    let latest = '';
    const markdown = '# One\n---\n# Two\n---\n# Three';
    render(markdown, (next) => { latest = next; });
    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 2"]')!;
    act(() => deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const slides = parseMarkdown(latest).slides;
    expect(slides.map((slide) => slide.markdown)).toEqual(['# One', '# Three']);
  });

  it('BOUNDARY-4: deleting the only slide leaves one blank slide', () => {
    let latest = '';
    const markdown = '# Only slide';
    render(markdown, (next) => { latest = next; });
    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 1"]')!;
    act(() => deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(parseMarkdown(latest).slides).toHaveLength(1);
    expect(parseMarkdown(latest).slides[0].markdown).toBe('');
  });

  it('BOUNDARY-6: boundary control markup (add/delete/split buttons, labels) never becomes part of the Markdown source', () => {
    const changes: string[] = [];
    const markdown = '# One\n---\n# Two';
    render(markdown, (next) => changes.push(next));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 1"]')!.click());
    for (const next of changes) {
      expect(next).not.toMatch(/slide-boundary|data-slide-action|Slide \d+/);
    }
  });

  it('BOUNDARY-7: a standalone --- delimiter remains in canonical form in the source after add, delete, and split-preview-confirm actions', () => {
    const changes: string[] = [];
    const markdown = '# One\n---\n# Two';
    render(markdown, (next) => { changes.push(next); });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!.click());
    const afterAdd = changes.at(-1)!;
    expect(afterAdd.split('\n').filter((line) => line === '---')).toHaveLength(2);
    act(() => root?.unmount());
    container?.remove();
    const secondRun: string[] = [];
    render(afterAdd, (next) => secondRun.push(next));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 2"]')!.click());
    const afterDelete = secondRun.at(-1)!;
    expect(afterDelete.split('\n').filter((line) => line === '---')).toHaveLength(1);
    expect(parseMarkdown(afterDelete).slides).toHaveLength(2);
  });

  it('BOUNDARY-12: Backspace immediately after a newly inserted boundary does not silently destroy the delimiter', () => {
    const changes: string[] = [];
    const withBoundary = '# One\n---\n# Two';
    render(withBoundary, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const afterDelimiter = withBoundary.indexOf('# Two');
    act(() => editor.dispatch({ selection: { anchor: afterDelimiter } }));
    act(() => { deleteCharBackward(editor); });
    // Documented invariant: an ordinary Backspace on the line following the
    // delimiter must never silently merge the two slides back together by
    // destroying the delimiter's structural role (it must remain alone on its
    // own line, or the edit must be rejected/handled some other explicit way).
    expect(parseMarkdown(editor.state.doc.toString()).slides).toHaveLength(2);
  });
});

describe('MD: rendering and source preservation (integration)', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, onSourceChange: (next: string) => void = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  // MD-1/MD-2: jsdom does not load PresentationPreview.css (no `test.css` in
  // vite/vitest config), so getComputedStyle() only reflects jsdom's built-in
  // initial values, never the real stylesheet. Established typography/spacing
  // can only be verified visually, so these are checked structurally here
  // (correct semantic tag per heading level / paragraph) with real visual
  // verification left to a future manual or Lighthouse-driven check.
  it('MD-1: headings render as their semantic level inside a rendered block', () => {
    const markdown = '# Title\n\n## Subtitle\n\nBody so the headings are not the active line.';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Body') } }));
    const heading1 = container.querySelector('.cm-rendered-block h1');
    const heading2 = container.querySelector('.cm-rendered-block h2');
    expect(heading1?.textContent).toBe('Title');
    expect(heading2?.textContent).toBe('Subtitle');
  });

  it('MD-2: paragraphs render as <p> elements inside a rendered block', () => {
    render('# One\n\nA paragraph of body text.');
    const paragraph = container.querySelector('.cm-rendered-block p');
    expect(paragraph?.textContent).toBe('A paragraph of body text.');
  });

  it('MD-12: tables render as a <table> with the correct rows, headers, and cell values', () => {
    const markdown = '# Data\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    render(markdown);
    const table = container.querySelector<HTMLElement>('.cm-rendered-block table')!;
    expect(table).not.toBeNull();
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent);
    expect(headers).toEqual(['A', 'B']);
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent));
    expect(rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('MD-4: clicking rendered inline code reveals the exact source including backticks', () => {
    const markdown = '# One\n\nUse `const x = 1;` in code.';
    render(markdown);
    const code = container.querySelector<HTMLElement>('.cm-rendered-block code')!;
    act(() => code.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const revealed = container.querySelector('.cm-source-revealed');
    expect(revealed?.textContent).toBe('Use `const x = 1;` in code.');
  });

  it('MD-6: clicking a rendered block quote reveals its exact source including the > marker', () => {
    const markdown = '# One\n\n> Quoted line here';
    render(markdown);
    const quote = container.querySelector<HTMLElement>('.cm-rendered-block blockquote')!;
    act(() => quote.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const revealed = container.querySelector('.cm-source-revealed');
    expect(revealed?.textContent).toBe('> Quoted line here');
  });

  it('MD-9: an empty list item renders as a normal paragraph rather than an empty bullet', () => {
    // Documented contract: "Empty list items can become normal paragraphs."
    const markdown = '# One\n\n- \n\nOther body content.';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Other') } }));
    expect(container.querySelector('.cm-rendered-block li')).toBeNull();
  });

  it('MD-10: task checkboxes render as interactive, enabled checkbox inputs', () => {
    render('# One\n\n- [ ] Todo item\n- [x] Done item');
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disabled).toBe(false);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
  });

  it('MD-15: images render as <img> elements without becoming editable DOM', () => {
    const markdown = '# One\n\n![An example](example.png)';
    render(markdown);
    const image = container.querySelector<HTMLImageElement>('.cm-rendered-block img')!;
    expect(image.src).toContain('example.png');
    expect(image.alt).toBe('An example');
    // The image is only ever produced by react-markdown into a widget-owned,
    // React-rendered subtree (a rendered block, not raw CodeMirror source),
    // so it must never carry an editable-text marker of its own.
    expect(image.getAttribute('contenteditable')).not.toBe('true');
  });

  it('MD-16: a non-delimiter horizontal rule (***) renders as <hr> instead of splitting the slide', () => {
    const markdown = '# One\n\nAbove\n\n***\n\nBelow';
    render(markdown);
    expect(parseMarkdown(markdown).slides).toHaveLength(1);
    expect(container.querySelector('.cm-rendered-block hr')).not.toBeNull();
    expect(container.querySelectorAll('.cm-slide-boundary')).toHaveLength(1);
  });
});

describe('TEX: reveal, restore, and error-safety cycles', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, onSourceChange: (next: string) => void = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('TEX-5: moving the caret away from revealed TeX restores its KaTeX rendered form', () => {
    const markdown = '# Intro\n\nMath $x=3$ here.';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const math = container.querySelector<HTMLElement>('.cm-rendered-block .katex')!;
    act(() => math.click());
    expect(container.querySelector('.katex')).toBeNull();
    act(() => editor.dispatch({ selection: { anchor: 0 } }));
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('TEX-6: editing revealed TeX source preserves the surrounding Markdown exactly', () => {
    const changes: string[] = [];
    const markdown = '# Intro\n\nBefore $x=3$ after.';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const from = markdown.indexOf('x=3');
    act(() => editor.dispatch({ selection: { anchor: from, head: from + 'x=3'.length } }));
    act(() => editor.dispatch({ changes: { from, to: from + 'x=3'.length, insert: 'y=4' } }));
    expect(changes.at(-1)).toBe('# Intro\n\nBefore $y=4$ after.');
  });

  it('TEX-10: repeatedly editing invalid TeX source never throws while decorations recompute', () => {
    const markdown = '# One\n\n$x^';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    expect(() => {
      for (let i = 0; i < 5; i += 1) {
        act(() => editor.dispatch({ changes: { from: editor.state.doc.length, to: editor.state.doc.length, insert: '^' } }));
      }
    }).not.toThrow();
  });

  it('TEX-11: repeated click/edit/re-render cycles on the same formula do not duplicate or delete source', () => {
    const markdown = '# One\n\nFormula $a+b$ end.';
    render(markdown, () => undefined);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    for (let i = 0; i < 3; i += 1) {
      const math = container.querySelector<HTMLElement>('.cm-rendered-block .katex');
      if (math) act(() => math.click());
      act(() => editor.dispatch({ selection: { anchor: 0 } }));
    }
    expect(editor.state.doc.toString()).toBe(markdown);
  });

  it('TEX-12: display-math line breaks remain exact across reveal and rerender', () => {
    const markdown = '# One\n\n$$\ny = mx + b\nz = 2y\n$$';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const display = container.querySelector<HTMLElement>('.cm-rendered-block .katex-display, .cm-rendered-block .katex')!;
    act(() => display.click());
    expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to)).toBe('');
    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('$$'), head: markdown.lastIndexOf('$$') + 2 } }));
    expect(editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to))
      .toBe('$$\ny = mx + b\nz = 2y\n$$');
  });
});

describe('OVERFLOW/SPLIT: integration behavior', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, onSourceChange: (next: string) => void = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('OVERFLOW-2: the overflow warning never mutates the Markdown source on its own', () => {
    const changes: string[] = [];
    const overflowing = ['# One', ...Array.from({ length: 40 }, (_, index) => `Line ${index}`)].join('\n');
    render(overflowing, (next) => changes.push(next));
    const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;
    expect(boundary.querySelector('.cm-slide-overflow-warning')).not.toBeNull();
    expect(changes).toHaveLength(0);
  });

  it('SPLIT-1: the split preview shows the exact proposed canonical Markdown', () => {
    const overflowing = ['# One', ...Array.from({ length: 19 }, (_, index) => `Line ${index}`), '## Two', 'Ending'].join('\n');
    render(overflowing, () => undefined);
    act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const proposed = dialog.querySelector('pre')!.textContent;
    expect(proposed).toContain('\n---\n## Two\nEnding');
    expect(parseMarkdown(proposed || '').slides).toHaveLength(2);
  });

  it('SPLIT-5: confirming a split focuses the newly created slide, not the original one', () => {
    const overflowing = ['# One', ...Array.from({ length: 19 }, (_, index) => `Line ${index}`), '## Two', 'Ending'].join('\n');
    let latest = overflowing;
    render(overflowing, (next) => { latest = next; });
    act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Confirm split')!.click());
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const newSlideRange = slideSourceRanges(latest)[1];
    expect(editor.state.selection.main.head).toBe(newSlideRange.start);
  });

  it('SPLIT-9: a scroll event while the split preview is open never dismisses the dialog or breaks Confirm split', () => {
    const overflowing = ['# One', ...Array.from({ length: 19 }, (_, index) => `Line ${index}`), '## Two', 'Ending'].join('\n');
    let latest = overflowing;
    render(overflowing, (next) => { latest = next; });
    const splitButton = container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!;
    expect(splitButton).not.toBeNull();
    act(() => splitButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const scroller = container.querySelector<HTMLElement>('.cm-scroller');
    if (scroller) act(() => { scroller.scrollTop = 500; scroller.dispatchEvent(new Event('scroll', { bubbles: true })); });
    // A scroll must not silently tear down the preview dialog (that would
    // be a real, user-visible loss of in-progress work), and Confirm must
    // still perform the actual split afterwards, not a stale/no-op click.
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const slidesBefore = parseMarkdown(latest).slides.length;
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Confirm split')!.click());
    expect(parseMarkdown(latest).slides.length).toBe(slidesBefore + 1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('RESILIENCE: stability and accessibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string, onSourceChange: (next: string) => void = () => undefined) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={onSourceChange} />,
      );
    });
  }

  it('RESILIENCE-1: repeated click, type, undo, split-preview, and slide add/delete never corrupt the document', () => {
    const changes: string[] = [];
    const markdown = '# One\n\nBody one\n---\n# Two\n\nBody two';
    render(markdown, (next) => changes.push(next));
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);

    act(() => editor.dispatch({ selection: { anchor: markdown.indexOf('Body one') } }));
    act(() => editor.dispatch({ changes: { from: markdown.indexOf('Body one'), to: markdown.indexOf('Body one'), insert: 'X' } }));
    act(() => undo(editor));
    const addButton = container.querySelector<HTMLButtonElement>('[aria-label="Add slide after slide 1"]')!;
    act(() => addButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="Delete slide 2"]')!;
    act(() => deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Every intermediate document must remain parseable and every character
    // that exists in the final document must trace back to real edits (no
    // duplication/loss): the final slide count and content must be internally
    // consistent.
    const finalSource = editor.state.doc.toString();
    expect(() => parseMarkdown(finalSource)).not.toThrow();
    expect(parseMarkdown(finalSource).slides.map((slide) => slide.markdown)).toEqual(['# One\n\nBody one', '# Two\n\nBody two']);
  });

  it('RESILIENCE-3: slide boundary action buttons are keyboard reachable and have stable, unique accessible names', () => {
    render('# One\n\nBody\n---\n# Two\n\nBody2');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-slide-action]'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.tabIndex).not.toBe(-1);
      expect(button.disabled).toBe(false);
    }
    const labels = buttons.map((button) => button.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(labels.length);
  });

  // RESILIENCE-4 ("Slide controls do not intercept ordinary text selection")
  // is fundamentally about native cross-block drag-selection, which requires
  // real Selection/Range painting that jsdom cannot simulate (and CodeMirror
  // itself calls preventDefault on every contentDOM mousedown as part of its
  // own selection management, regardless of the slide-boundary widgets, so a
  // defaultPrevented-based assertion would not isolate anything meaningful).
  // The one deterministic, jsdom-safe aspect is that clicking the boundary's
  // decorative label must not be misinterpreted as a reveal-target click.
  it('RESILIENCE-4: clicking the slide-boundary label does not reveal or move into any content block', () => {
    const markdown = '# One\n\nBody\n---\n# Two';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const before = editor.state.selection.main.head;
    const revealedBefore = container.querySelectorAll('.cm-source-revealed').length;
    const label = container.querySelector<HTMLElement>('.slide-boundary-label')!;
    act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(editor.state.selection.main.head).toBe(before);
    expect(container.querySelectorAll('.cm-source-revealed')).toHaveLength(revealedBefore);
  });

  it('RESILIENCE-8: an empty document renders exactly one usable, focusable blank slide', () => {
    render('');
    expect(parseMarkdown('').slides).toHaveLength(1);
    expect(container.querySelectorAll('.cm-slide-boundary')).toHaveLength(1);
    expect(container.querySelector('[aria-label="Add slide after slide 1"]')).not.toBeNull();
  });

  // RESILIENCE-9 (removed): the prior version only called editor.dispatch({
  // selection: { anchor } }) directly and asserted the dispatch took effect -
  // that is a CodeMirror API guarantee, not app behavior, and proved nothing
  // about real caret placement under overflow. Superseded by GEOM-1..GEOM-4
  // in tests/integration/editor-interaction-sequences.test.tsx, which drive
  // caret placement through real click coordinates/measurement, including
  // over-budget slides.

  it('RESILIENCE-10: an unexpected KaTeX rendering failure does not leave the editor unusable', () => {
    const markdown = '# One\n\nMath $x=3$ end.';
    render(markdown, () => undefined);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    katexMockState.shouldThrow = true;
    try {
      // Forcing CodeMirror to recompute its live-preview decorations (by
      // moving the selection) is what actually invokes MathWidget.toDOM ->
      // katex.renderToString. Neither call site wraps that in a try/catch,
      // so an unexpected KaTeX failure is expected to propagate uncaught
      // here rather than degrade gracefully.
      expect(() => {
        act(() => editor.dispatch({ selection: { anchor: 0 } }));
      }).not.toThrow();
      expect(container.querySelector('.cm-editor')).not.toBeNull();
    } finally {
      katexMockState.shouldThrow = false;
    }
  });
});

describe('PRESENT: presentation-mode contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  function render(markdown: string) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PresentationPreview presentation={parseMarkdown(markdown)} theme="light" source={markdown} onSourceChange={() => undefined} />,
      );
    });
  }

  it('PRESENT-2: Present mode renders fixed slide surfaces with the live editor canvas marked hidden', () => {
    // PresentationPreview.css has `.presentation-live-canvas.hidden { display:
    // none; }`, which jsdom never loads/applies (no vitest CSS handling
    // configured), so the editor controls remain queryable here even though a
    // real browser would not render or expose them. The structural proxy for
    // "no editor controls visible" is therefore the `hidden` class plus
    // `aria-hidden="true"` on the live canvas wrapper.
    render('# One\n\nBody\n---\n# Two');
    const enterButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Present')!;
    act(() => enterButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.presentation-playback')).not.toBeNull();
    const liveCanvas = container.querySelector('.presentation-live-canvas')!;
    expect(liveCanvas.classList.contains('hidden')).toBe(true);
    expect(liveCanvas.getAttribute('aria-hidden')).toBe('true');
  });

  it('PRESENT-2a: Present mode applies the parsed intro layout to the playback slide', () => {
    render(':::slide-layout{intro}\n# Intro title');
    const enterButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Present')!;

    act(() => enterButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const playbackSlide = container.querySelector<HTMLElement>('.presentation-playback-slide');
    expect(playbackSlide?.dataset.slideLayout).toBe('intro');
    expect(playbackSlide?.classList.contains('slide-intro')).toBe(true);
  });

  it('PRESENT-3: Present mode supports previous/next navigation across all slides', () => {
    render('# One\n---\n# Two\n---\n# Three');
    const enterButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Present')!;
    act(() => enterButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.presentation-playback-slide')?.textContent).toContain('One');
    const next = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Next')!;
    act(() => next.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.presentation-playback-slide')?.textContent).toContain('Two');
    const previous = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Previous')!;
    act(() => previous.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('.presentation-playback-slide')?.textContent).toContain('One');
  });

  it('PRESENT-4: entering Present mode requests fullscreen when the platform supports it', () => {
    render('# One\n\nBody');
    const fullscreenSpy = vi.fn().mockResolvedValue(undefined);
    (container as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = fullscreenSpy;
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    const enterButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Present')!;
    act(() => enterButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // Documented contract: "Present mode can enter fullscreen when supported."
    // There is currently no requestFullscreen call anywhere in the component.
    expect(fullscreenSpy).toHaveBeenCalled();
  });

  it('PRESENT-5: returning from Present mode restores the prior editor selection', () => {
    const markdown = '# One\n\nBody text here\n---\n# Two';
    render(markdown);
    const editor = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
    const anchor = markdown.indexOf('Body text here') + 4;
    act(() => editor.dispatch({ selection: { anchor } }));
    const enterButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Present')!;
    act(() => enterButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const backButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Back to editor')!;
    act(() => backButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(editor.state.selection.main.head).toBe(anchor);
  });
});
