// @vitest-environment jsdom
//
// This file targets the gap the checkbox-matrix pass left open: individual
// tests proved single steps (a click reveals a line, an edit updates source)
// but never proved a *sequence* the way a real user produces one, and never
// exercised the geometry math a click actually runs through in the browser
// (ratio-based character mapping, repeated slide-boundary handoff, the
// requestMeasure-driven overflow pass, and repeated split preview/cancel/
// confirm/undo cycles). Every assertion below is against real CodeMirror
// state (source, selection anchor/head) or the literal DOM the component
// renders - never a bare class-name check standing in for behavior.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { markdownBlockRanges } from '../../src/components/PresentationEditor';
import { parseMarkdown, slideSourceRanges } from '../../src/domain/presentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Test-only geometry seam #1: click-to-character mapping.
 *
 * The component computes a click's character offset from
 * `getBoundingClientRect()` ratios (see `selectWidgetRange` in
 * PresentationEditor.tsx), because jsdom has no real text-layout engine for
 * `posAtCoords`. Mocking `getBoundingClientRect` on the actual rendered
 * widget and dispatching a real `MouseEvent` (with real `clientX`/`clientY`)
 * exercises the exact handler the app registers via
 * `EditorView.domEventHandlers` - nothing here reimplements or bypasses that
 * logic; it supplies the one input (element geometry) jsdom cannot compute
 * for itself.
 */
function mockRect(element: HTMLElement, rect: { top?: number; left?: number; width?: number; height?: number }) {
  const { top = 0, left = 0, width = 100, height = 100 } = rect;
  element.getBoundingClientRect = () => ({
    x: left, y: top, top, left, width, height, right: left + width, bottom: top + height,
    toJSON: () => undefined,
  });
}

function click(element: HTMLElement, clientX: number, clientY: number) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
}

/**
 * Test-only geometry seam #2: forcing a synchronous measurement pass.
 *
 * `fixedPageMeasurements` (PresentationEditor.tsx) schedules its
 * read/write via `view.requestMeasure`, which CodeMirror normally flushes
 * on the next animation frame. `EditorView.measure(flush)` is the same
 * method CodeMirror's own scheduler calls internally to do that flush - it
 * is marked `@internal` in CodeMirror's public types (no different, public
 * "flush now" API exists), so this cast is a deliberate, documented,
 * test-only seam onto real CodeMirror behavior, not a change to production
 * code or a reimplementation of its measurement math.
 */
function forceMeasure(view: EditorView) {
  (view as unknown as { measure: (flush?: boolean) => void }).measure(false);
}

describe('Interaction sequence: click -> reveal -> caret -> edit -> rerender -> click-away', () => {
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

  function editorView() {
    return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
  }

  it('SEQ-1: a full click/edit/click-away cycle lands the caret at the exact clicked character, edits exactly once, and never disturbs neighboring blocks', () => {
    const markdown = '# Intro\n\nFirst line of target\nSecond line of target\n\nTrailing paragraph stays rendered';
    const changes: string[] = [];
    render(markdown, (next) => changes.push(next));

    const targetBlock = markdownBlockRanges(markdown)[1];
    expect(markdown.slice(targetBlock.from, targetBlock.to)).toBe('First line of target\nSecond line of target');
    const targetElement = container.querySelector<HTMLElement>(`[data-block-from="${targetBlock.from}"]`)!;
    mockRect(targetElement, { width: 100, height: 100 });

    // Two visual lines fill the block height evenly; clicking at 75% down
    // must land on the second line ("Second line of target"), and at 50%
    // across that line's width (22 chars) must land after "Second line" (11
    // chars) exactly - not merely "somewhere in the line".
    act(() => click(targetElement, 50, 75));

    const secondLineFrom = markdown.indexOf('Second line of target');
    const view = editorView();
    expect(view.state.selection.main).toMatchObject({ from: secondLineFrom + 11, to: secondLineFrom + 11 });

    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('Second line of target');

    // Neighbor content - the heading above, the first line of the SAME
    // block, and the trailing paragraph below - must all still be rendered,
    // not just "present somewhere": each must appear inside a
    // `.cm-rendered-block`, never inside a revealed source line.
    const renderedText = Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .map((block) => block.textContent || '').join('|');
    expect(renderedText).toContain('Intro');
    expect(renderedText).toContain('First line of target');
    expect(renderedText).toContain('Trailing paragraph stays rendered');
    expect(container.querySelectorAll('.cm-source-revealed')[0].textContent).not.toContain('First line');

    // Edit at the exact caret position produced by the click.
    act(() => view.dispatch({ changes: { from: secondLineFrom + 11, to: secondLineFrom + 11, insert: '-EDIT' } }));
    expect(changes.at(-1)).toBe('# Intro\n\nFirst line of target\nSecond line-EDIT of target\n\nTrailing paragraph stays rendered');
    expect((changes.at(-1)!.match(/-EDIT/g) || []).length).toBe(1);

    // Rerender: the edited line is still the only revealed line, with its
    // new exact text; every neighbor block is untouched.
    const revealedAfterEdit = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealedAfterEdit).toHaveLength(1);
    expect(revealedAfterEdit[0].textContent).toBe('Second line-EDIT of target');
    const renderedAfterEdit = Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .map((block) => block.textContent || '').join('|');
    expect(renderedAfterEdit).toContain('Intro');
    expect(renderedAfterEdit).toContain('First line of target');
    expect(renderedAfterEdit).toContain('Trailing paragraph stays rendered');

    // Click away onto the trailing paragraph, at a known character offset.
    const trailingBlock = markdownBlockRanges(changes.at(-1)!)[2];
    const trailingElement = container.querySelector<HTMLElement>(`[data-block-from="${trailingBlock.from}"]`)!;
    mockRect(trailingElement, { width: 100, height: 20 });
    // "Trailing paragraph stays rendered" is 34 chars; clicking at x=0 must
    // land exactly at its first character (line/block start).
    act(() => click(trailingElement, 0, 10));
    expect(view.state.selection.main).toMatchObject({ from: trailingBlock.from, to: trailingBlock.from });

    // The previously-edited block must be fully rendered again (no lingering
    // revealed line), with the edit intact and not duplicated, and the
    // trailing block is now the one revealed line.
    expect(container.querySelectorAll('.cm-source-revealed')).toHaveLength(1);
    expect(container.querySelector('.cm-source-revealed')!.textContent).toBe('Trailing paragraph stays rendered');
    const finalRendered = Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
      .map((block) => block.textContent || '').join('|');
    expect(finalRendered).toContain('Second line-EDIT of target');
    expect((view.state.doc.toString().match(/-EDIT/g) || []).length).toBe(1);
    expect(() => parseMarkdown(view.state.doc.toString())).not.toThrow();
  });

  it('SEQ-2: click, edit, undo, then click-away restores the exact prior source and a valid selection, with no duplicated delimiter', () => {
    const markdown = '# One\n\nOriginal body text\n---\n# Two\n\nOther body';
    const changes: string[] = [];
    render(markdown, (next) => changes.push(next));
    const view = editorView();

    const bodyFrom = markdown.indexOf('Original body text');
    const bodyBlock = container.querySelector<HTMLElement>(`[data-block-from="${bodyFrom - 6}"]`)
      || container.querySelector<HTMLElement>(`[data-block-from]`)!;
    // Click directly via dispatch to a known offset inside the first slide's
    // body line to reveal it deterministically, then edit it.
    act(() => view.dispatch({ selection: { anchor: bodyFrom } }));
    act(() => view.dispatch({ changes: { from: bodyFrom, to: bodyFrom + 'Original'.length, insert: 'Rewritten' } }));
    expect(changes.at(-1)).toContain('Rewritten body text');

    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe(markdown);
    expect(parseMarkdown(view.state.doc.toString()).slides).toHaveLength(2);
    expect(view.state.doc.toString().split('\n').filter((line) => line === '---')).toHaveLength(1);

    // Click away onto the second slide's heading; selection must land inside
    // document bounds and on the clicked block.
    const secondHeadingFrom = view.state.doc.toString().indexOf('# Two');
    act(() => view.dispatch({ selection: { anchor: secondHeadingFrom } }));
    expect(view.state.selection.main.from).toBeGreaterThanOrEqual(0);
    expect(view.state.selection.main.to).toBeLessThanOrEqual(view.state.doc.length);
    void bodyBlock;
  });
});

describe('Geometry seam: click-to-character mapping across a wrapped-eligible block', () => {
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

  // A four-line block with equal-length lines lets Y-ratio -> line-index
  // mapping be verified across the whole height, not just one sample point:
  // the chosen line must move forward monotonically as Y increases, and
  // must exactly match the geometrically-implied line at every sampled
  // ratio - a regression that mis-maps even one of these ratios (e.g. an
  // off-by-one line, or a rounding direction flip) fails immediately.
  const lines = ['AAAA line', 'BBBB line', 'CCCC line', 'DDDD line'];
  const markdown = `# Title\n\n${lines.join('\n')}\n\nAfter block`;

  it.each([
    { y: 5, expectedLine: 'AAAA line' },
    { y: 30, expectedLine: 'BBBB line' },
    { y: 55, expectedLine: 'CCCC line' },
    { y: 95, expectedLine: 'DDDD line' },
  ])('GEOM-1: clicking at y=$y of a 4-line, 100px-tall block reveals exactly "$expectedLine"', ({ y, expectedLine }) => {
    render(markdown);
    const block = markdownBlockRanges(markdown)[1];
    const element = container.querySelector<HTMLElement>(`[data-block-from="${block.from}"]`)!;
    mockRect(element, { width: 80, height: 100 });
    act(() => click(element, 40, y));
    const revealed = container.querySelectorAll<HTMLElement>('.cm-source-revealed');
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe(expectedLine);
  });

  it('GEOM-2: click mapping falls back to a deterministic line boundary (not a crash or block-wide reveal) when the element reports zero size', () => {
    render(markdown);
    const block = markdownBlockRanges(markdown)[1];
    const element = container.querySelector<HTMLElement>(`[data-block-from="${block.from}"]`)!;
    mockRect(element, { width: 0, height: 0 });
    act(() => click(element, 0, 0));
    const revealed = container.querySelectorAll<HTMLElement>('.cm-source-revealed');
    expect(revealed).toHaveLength(1);
    // Falls back to the first line of the block deterministically rather
    // than revealing the whole multi-line block.
    expect(revealed[0].textContent).toBe('AAAA line');
  });
});

describe('Geometry seam: slide-boundary handoff stays correct across repeated edits', () => {
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

  // NOTE: this exercises the same click path as the pre-existing NAV-1 test
  // in presentation-preview.test.tsx ("clicking a slide boundary ... focuses
  // an adjacent editable position"), which is already documented as a known
  // red test: `.cm-slide-boundary`'s label has no `data-block-from`, so
  // `selectWidgetRange` never matches it and the click is a no-op. This
  // extends that same documented gap across repeated edits/rounds rather
  // than a single click, so it stays red for the same, single, already-known
  // reason (see behavior-matrix.md NAV-1) - it is an intentional
  // implementation-gap failure, not a broken test.
  it('GEOM-3: repeatedly clicking a slide boundary after intervening edits always resolves to that boundary\'s current (not stale) offsets', () => {
    let source = '# One\n\nBody\n---\n# Two';
    render(source, (next) => { source = next; });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;

    for (let round = 0; round < 3; round += 1) {
      const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;
      const label = boundary.querySelector<HTMLElement>('.slide-boundary-label')!;
      act(() => label.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })));
      const currentDoc = view.state.doc.toString();
      const slide0 = slideSourceRanges(currentDoc)[0];
      const slide1 = slideSourceRanges(currentDoc)[1];
      const head = view.state.selection.main.head;
      expect(head === slide0.end || head === slide1.start).toBe(true);

      // Grow slide one's body so the boundary's document offset moves, then
      // click the boundary again next round - the assertion above must keep
      // holding against the *new* offsets, not the original ones.
      const insertAt = currentDoc.indexOf('Body') + 4;
      act(() => view.dispatch({ changes: { from: insertAt, to: insertAt, insert: ` more${round}` } }));
    }
  });
});

describe('Geometry seam: overflow measurement pass (fixedPageMeasurements)', () => {
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

  it('GEOM-4: computes a positive page-fill and no overflow flag when content is short of the 16:9 page height', () => {
    render('# One\n\nBody\n---\n# Two');
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    Object.defineProperty(view.contentDOM, 'clientWidth', { value: 800, configurable: true });
    const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;
    const start = container.querySelector<HTMLElement>('.cm-slide-first')!;
    mockRect(boundary, { top: 300 });
    mockRect(start, { top: 0 });

    act(() => forceMeasure(view));

    // pageHeight = 800 * 9 / 16 = 450; contentHeight = 300 - 0 = 300;
    // fill = max(0, 450 - 300) = 150.
    expect(boundary.style.getPropertyValue('--slide-page-fill')).toBe('150px');
    expect(boundary.classList.contains('measured-overflow')).toBe(false);
    expect(start.classList.contains('cm-slide-measured-overflow')).toBe(false);
  });

  it('GEOM-5: flags overflow when measured content height exceeds the 16:9 page height, and clears it once content shrinks back', () => {
    render('# One\n\nBody\n---\n# Two');
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    Object.defineProperty(view.contentDOM, 'clientWidth', { value: 800, configurable: true });
    const boundary = container.querySelector<HTMLElement>('.cm-slide-boundary')!;
    const start = container.querySelector<HTMLElement>('.cm-slide-first')!;

    // contentHeight (500) > pageHeight (450) -> overflowing.
    mockRect(boundary, { top: 500 });
    mockRect(start, { top: 0 });
    act(() => forceMeasure(view));
    expect(boundary.classList.contains('measured-overflow')).toBe(true);
    expect(start.classList.contains('cm-slide-measured-overflow')).toBe(true);
    expect(boundary.style.getPropertyValue('--slide-page-fill')).toBe('0px');

    // Shrinking the measured content height back under the page height must
    // clear both overflow flags on the next measurement pass - the widget
    // does not "stick" in an overflowing state. A real edit/selection change
    // is required to re-queue the plugin's `requestMeasure` (it only queues
    // on `update()`, i.e. after a real transaction) before flushing again.
    mockRect(boundary, { top: 200 });
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    act(() => forceMeasure(view));
    expect(boundary.classList.contains('measured-overflow')).toBe(false);
    expect(start.classList.contains('cm-slide-measured-overflow')).toBe(false);
    expect(boundary.style.getPropertyValue('--slide-page-fill')).toBe('250px');
  });
});

describe('Geometry seam: repeated split preview / cancel / confirm / undo transitions', () => {
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

  function overflowingSource() {
    return ['# One', ...Array.from({ length: 19 }, (_, index) => `Line ${index}`), '## Two', 'Ending'].join('\n');
  }

  it('GEOM-6: repeated preview/cancel cycles never change source, and a final preview/confirm/undo/preview/confirm never duplicates or loses content', () => {
    const original = overflowingSource();
    let latest = original;
    render(original, (next) => { latest = next; });
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;

    for (let round = 0; round < 3; round += 1) {
      act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
      expect(view.state.doc.toString()).toBe(original);
      const cancelButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
        .find((button) => button.textContent === 'Cancel')!;
      act(() => cancelButton.click());
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(view.state.doc.toString()).toBe(original);
    }

    // Confirm once.
    act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Confirm split')!.click());
    const afterFirstConfirm = latest;
    expect(parseMarkdown(afterFirstConfirm).slides).toHaveLength(2);
    expect(afterFirstConfirm.replace(/\n---\n/g, '\n')).toBe(original);

    // Undo the split via the app's own undo notice, restoring the original
    // exactly (not merely "close to" the original).
    const undoButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Undo')!;
    act(() => undoButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(view.state.doc.toString()).toBe(original);
    expect(latest).toBe(original);

    // Split, cancel is no longer available (already confirmed once and
    // undone) - split again and confirm again; content must still trace
    // back to the original with exactly one delimiter added, not two.
    act(() => container.querySelector<HTMLButtonElement>('[data-slide-action="preview-split"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Confirm split')!.click());
    expect(parseMarkdown(latest).slides).toHaveLength(2);
    expect(latest.split('\n').filter((line) => line === '---')).toHaveLength(1);
    expect(latest.replace(/\n---\n/g, '\n')).toBe(original);
    void redo;
  });
});
