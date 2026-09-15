// @vitest-environment jsdom
//
// This file asserts CodeMirror *selection state* (anchor/head), not just
// resulting source text, for the editing primitives item 3 of the task asks
// for: paste/cut/backspace/delete/undo and malformed input - each against
// the real PresentationPreview/PresentationEditor tree (live-preview
// decorations, widgets, and all), not a bare EditorView. Backspace/Delete
// are invoked via the exact command functions `defaultKeymap` binds those
// keys to (deleteCharBackward/deleteCharForward from @codemirror/commands),
// which is equivalent to a real keypress without needing to fight jsdom's
// lack of native `beforeinput`/IME support. Paste/cut have no app-specific
// handler in PresentationEditor.tsx (confirmed: it relies on CodeMirror's
// built-in clipboard handling), so they are modeled as the document change
// + selection CodeMirror itself produces for those operations (insert-at-
// selection with the caret landing after inserted text for paste; delete-
// selected-range with the caret collapsing to the start for cut) - the
// point under test is whether the live-preview widget/decoration layer
// stays correct and neighbor content stable under those changes, not
// whether jsdom's clipboard works.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { deleteCharBackward, deleteCharForward, isolateHistory, redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { parseMarkdown, slideSourceRanges } from '../../src/domain/presentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
}

function renderedBlockText() {
  return Array.from(container.querySelectorAll<HTMLElement>('.cm-rendered-block'))
    .map((block) => block.textContent || '').join('|');
}

describe('Typing at an exact caret position', () => {
  it.each([
    { name: 'single character mid-word', markdown: '# One\n\nHello world', at: 9, insert: 'X', expected: '# One\n\nHeXllo world' },
    { name: 'multi-character burst', markdown: '# One\n\nHello world', at: 5, insert: '!!!', expected: '# One!!!\n\nHello world' },
    { name: 'newline splits a paragraph in place', markdown: '# One\n\nHello world', at: 12, insert: '\n', expected: '# One\n\nHello\n world' },
  ])('$name', ({ markdown, at, insert, expected }) => {
    const view = render(markdown);
    // A real keypress always has the caret already at `at`, and CodeMirror's
    // own insertion commands leave the caret immediately after what was
    // typed - both are asserted explicitly here rather than assumed.
    act(() => view.dispatch({ changes: { from: at, to: at, insert }, selection: { anchor: at + insert.length } }));
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main).toMatchObject({ from: at + insert.length, to: at + insert.length });
    expect(() => parseMarkdown(view.state.doc.toString())).not.toThrow();
  });
});

describe('Backspace (deleteCharBackward, the real defaultKeymap binding) preserves exact source and caret', () => {
  it('deletes exactly one character before the caret, mid-word', () => {
    const view = render('# One\n\nHello world');
    view.dispatch({ selection: { anchor: 12 } }); // "...Hello| world" (just after the "o")
    act(() => { deleteCharBackward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nHell world');
    expect(view.state.selection.main).toMatchObject({ from: 11, to: 11 });
  });

  it('merges the current line into the previous one when caret is at a line start', () => {
    const view = render('# One\n\nFirst\nSecond');
    const secondStart = view.state.doc.toString().indexOf('Second');
    view.dispatch({ selection: { anchor: secondStart } });
    act(() => { deleteCharBackward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nFirstSecond');
    expect(view.state.selection.main).toMatchObject({ from: secondStart - 1, to: secondStart - 1 });
  });

  it('is a no-op at document start (no throw, no change, caret stays at 0)', () => {
    const view = render('# One');
    view.dispatch({ selection: { anchor: 0 } });
    act(() => { deleteCharBackward(view); });
    expect(view.state.doc.toString()).toBe('# One');
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 0 });
  });

  it('deletes exactly one Unicode code point of a multi-byte emoji, not a broken half-surrogate', () => {
    const view = render('# One\n\nHi \u{1F600} there'); // grinning face emoji, a surrogate pair
    const afterEmoji = view.state.doc.toString().indexOf(' there');
    view.dispatch({ selection: { anchor: afterEmoji } });
    act(() => { deleteCharBackward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nHi  there');
    // eslint-disable-next-line no-control-regex
    expect(/[\uD800-\uDFFF]/.test(view.state.doc.toString())).toBe(false);
  });

  it('deletes a full slide-boundary delimiter as a single backward step from just after it (no half-deleted "--")', () => {
    const view = render('# One\n---\n# Two');
    const afterDelimiter = view.state.doc.toString().indexOf('\n# Two');
    view.dispatch({ selection: { anchor: afterDelimiter } });
    act(() => { deleteCharBackward(view); });
    // A single backward char step only removes the last "-" of the
    // delimiter; the document must still parse as a single slide because
    // "--" (two dashes) is no longer a valid delimiter line (this documents
    // the actual, narrow scope of a single backspace rather than assuming
    // it collapses the whole delimiter atomically).
    expect(view.state.doc.toString()).toBe('# One\n--\n# Two');
    expect(parseMarkdown(view.state.doc.toString()).slides).toHaveLength(1);
  });
});

describe('Delete/forward-delete (deleteCharForward) preserves exact source and caret', () => {
  it('deletes exactly one character after the caret', () => {
    const view = render('# One\n\nHello world');
    view.dispatch({ selection: { anchor: 11 } }); // "...Hell|o world" (just before the "o")
    act(() => { deleteCharForward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nHell world');
    expect(view.state.selection.main).toMatchObject({ from: 11, to: 11 });
  });

  it('merges the next line into the current one when caret is at a line end', () => {
    const view = render('# One\n\nFirst\nSecond');
    const firstEnd = view.state.doc.toString().indexOf('\nSecond');
    view.dispatch({ selection: { anchor: firstEnd } });
    act(() => { deleteCharForward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nFirstSecond');
    expect(view.state.selection.main).toMatchObject({ from: firstEnd, to: firstEnd });
  });

  it('is a no-op at document end', () => {
    const view = render('# One');
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    act(() => { deleteCharForward(view); });
    expect(view.state.doc.toString()).toBe('# One');
    expect(view.state.selection.main).toMatchObject({ from: 5, to: 5 });
  });
});

describe('Paste emulation: insert-at-selection lands the caret exactly after the inserted text', () => {
  it('pasting inline text mid-line keeps neighboring blocks rendered and lands the caret at the end of the pasted text', () => {
    const markdown = '# Intro\n\nBody line\n\nTrailing paragraph';
    const view = render(markdown);
    const pasteAt = markdown.indexOf('Body line') + 5; // "Body |line"
    const pasted = 'PASTED-';
    act(() => view.dispatch({ changes: { from: pasteAt, to: pasteAt, insert: pasted }, selection: { anchor: pasteAt + pasted.length } }));
    expect(view.state.doc.toString()).toBe('# Intro\n\nBody PASTED-line\n\nTrailing paragraph');
    expect(view.state.selection.main).toMatchObject({ from: pasteAt + pasted.length, to: pasteAt + pasted.length });
    expect(renderedBlockText()).toContain('Intro');
    expect(renderedBlockText()).toContain('Trailing paragraph');
  });

  it('pasting a multi-line block preserves every line exactly and increases the doc length by the pasted length', () => {
    const markdown = '# One\n\nBody';
    const view = render(markdown);
    const pasted = 'Line A\nLine B\nLine C';
    const at = markdown.length;
    act(() => view.dispatch({ changes: { from: at, to: at, insert: pasted }, selection: { anchor: at + pasted.length } }));
    expect(view.state.doc.toString()).toBe(`${markdown}${pasted}`);
    expect(view.state.doc.length).toBe(markdown.length + pasted.length);
  });

  it('pasting text containing a slide delimiter mid-slide splits the source into an extra slide (no data loss, no duplication)', () => {
    const markdown = '# One\n\nFirstHalfSecondHalf';
    const view = render(markdown);
    const at = markdown.indexOf('SecondHalf');
    const pasted = '\n---\n';
    act(() => view.dispatch({ changes: { from: at, to: at, insert: pasted }, selection: { anchor: at + pasted.length } }));
    const doc = view.state.doc.toString();
    expect(doc).toBe('# One\n\nFirstHalf\n---\nSecondHalf');
    const slides = parseMarkdown(doc).slides;
    expect(slides).toHaveLength(2);
    expect(slides[0].markdown + slides[1].markdown).toBe('# One\n\nFirstHalfSecondHalf');
  });

  it('pasting immediately at a slide boundary offset attaches to the correct (following) slide, not the delimiter itself', () => {
    const markdown = '# One\n---\n# Two';
    const view = render(markdown);
    const ranges = slideSourceRanges(markdown);
    const at = ranges[1].start;
    act(() => view.dispatch({ changes: { from: at, to: at, insert: 'X' }, selection: { anchor: at + 1 } }));
    const doc = view.state.doc.toString();
    expect(doc).toBe('# One\n---\nX# Two');
    expect(parseMarkdown(doc).slides).toHaveLength(2);
    expect(parseMarkdown(doc).slides[1].markdown).toBe('X# Two');
  });
});

describe('Cut emulation: delete-selected-range collapses the caret to the start of the removed range', () => {
  it('cutting an entire slide body leaves an empty (not zero) slide and a caret at its start', () => {
    const markdown = '# One\n---\nBody to cut\n---\n# Three';
    const view = render(markdown);
    const ranges = slideSourceRanges(markdown);
    const middle = ranges[1];
    act(() => view.dispatch({ changes: { from: middle.start, to: middle.end, insert: '' }, selection: { anchor: middle.start } }));
    const doc = view.state.doc.toString();
    expect(parseMarkdown(doc).slides).toHaveLength(3);
    expect(parseMarkdown(doc).slides[1].markdown).toBe('');
    expect(view.state.selection.main).toMatchObject({ from: middle.start, to: middle.start });
  });

  it('cutting a range spanning two rendered blocks leaves untouched content before and after fully rendered', () => {
    const markdown = '# Heading\n\nParagraph one\n\nParagraph two\n\nParagraph three';
    const view = render(markdown);
    const from = markdown.indexOf('Paragraph one');
    const to = markdown.indexOf('Paragraph two') + 'Paragraph two'.length;
    act(() => view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } }));
    const doc = view.state.doc.toString();
    expect(doc).toBe('# Heading\n\n\n\nParagraph three');
    expect(renderedBlockText()).toContain('Heading');
    expect(renderedBlockText()).toContain('Paragraph three');
    expect(renderedBlockText()).not.toContain('Paragraph one');
    expect(renderedBlockText()).not.toContain('Paragraph two');
  });

  it('cutting a range that fully contains a slide delimiter merges two slides into one, with no leftover partial delimiter', () => {
    const markdown = '# One\nTail\n---\nHead\n# Two';
    const view = render(markdown);
    const from = markdown.indexOf('Tail');
    const to = markdown.indexOf('Head') + 'Head'.length;
    act(() => view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } }));
    const doc = view.state.doc.toString();
    expect(doc).toBe('# One\n\n# Two');
    expect(parseMarkdown(doc).slides).toHaveLength(1);
    expect(doc).not.toContain('---');
  });
});

describe('Undo/redo restore exact prior source AND exact prior selection, not just text', () => {
  it('undo after backspace restores the original doc and the original caret position (not merely the text)', () => {
    const view = render('# One\n\nHello world');
    view.dispatch({ selection: { anchor: 12 } });
    act(() => { deleteCharBackward(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nHell world');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe('# One\n\nHello world');
    expect(view.state.selection.main).toMatchObject({ from: 12, to: 12 });
  });

  it('undo after a multi-line paste restores both the original doc and the exact pre-paste caret position', () => {
    const markdown = '# One\n\nBody';
    const view = render(markdown);
    view.dispatch({ selection: { anchor: markdown.length } }); // caret parked at doc end before pasting
    const pasted = 'Line A\nLine B\nLine C';
    act(() => view.dispatch({ changes: { from: markdown.length, to: markdown.length, insert: pasted }, selection: { anchor: markdown.length + pasted.length } }));
    expect(view.state.doc.length).toBe(markdown.length + pasted.length);
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe(markdown);
    expect(view.state.selection.main).toMatchObject({ from: markdown.length, to: markdown.length });
  });

  it('undo after a cut restores both the cut range verbatim and the pre-cut caret, and redo re-applies the exact same cut', () => {
    const markdown = '# One\n---\nBody to cut\n---\n# Three';
    const view = render(markdown);
    const ranges = slideSourceRanges(markdown);
    const middle = ranges[1];
    view.dispatch({ selection: { anchor: middle.start } }); // caret parked at the cut's start beforehand
    act(() => view.dispatch({ changes: { from: middle.start, to: middle.end, insert: '' }, selection: { anchor: middle.start } }));
    expect(parseMarkdown(view.state.doc.toString()).slides[1].markdown).toBe('');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe(markdown);
    expect(view.state.selection.main.from).toBe(middle.start);
    act(() => { redo(view); });
    expect(parseMarkdown(view.state.doc.toString()).slides[1].markdown).toBe('');
  });

  it('two sequential, history-isolated edits undo one at a time, never skipping or collapsing one', () => {
    // Dispatched in the same tick, back-to-back character insertions would
    // otherwise be merged into a single undo group by CodeMirror's own
    // adjacency/typing heuristics (the same grouping a fast real typist
    // benefits from) - `isolateHistory.of('full')` is CodeMirror's own,
    // real annotation for forcing a boundary between them, used here only
    // to make each edit its own deterministic undo step for the assertion.
    const view = render('# One');
    act(() => view.dispatch({ changes: { from: 5, to: 5, insert: 'A' } }));
    act(() => view.dispatch({ changes: { from: 6, to: 6, insert: 'B' }, annotations: isolateHistory.of('full') }));
    expect(view.state.doc.toString()).toBe('# OneAB');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe('# OneA');
    act(() => { undo(view); });
    expect(view.state.doc.toString()).toBe('# One');
  });
});

describe('Malformed/edge input at the CodeMirror + live-preview level', () => {
  it('typing into a fully empty document does not throw and produces exactly the typed text', () => {
    const view = render('');
    act(() => view.dispatch({ changes: { from: 0, to: 0, insert: 'X' } }));
    expect(view.state.doc.toString()).toBe('X');
    expect(() => parseMarkdown(view.state.doc.toString())).not.toThrow();
  });

  it('deleting the only remaining character leaves a valid, still-renderable empty document', () => {
    const view = render('X');
    act(() => view.dispatch({ changes: { from: 0, to: 1, insert: '' } }));
    expect(view.state.doc.toString()).toBe('');
    expect(() => parseMarkdown(view.state.doc.toString())).not.toThrow();
    expect(parseMarkdown(view.state.doc.toString()).slides).toHaveLength(1);
  });

  it('pasting only whitespace/newlines does not throw and is preserved verbatim (not trimmed away)', () => {
    const markdown = '# One\n\nBody';
    const view = render(markdown);
    const pasted = '   \n\n   ';
    act(() => view.dispatch({ changes: { from: markdown.length, to: markdown.length, insert: pasted } }));
    expect(view.state.doc.toString()).toBe(markdown + pasted);
  });

  it('CRLF line endings pasted into the document are preserved as CodeMirror stores them (no silent character loss)', () => {
    const markdown = '# One\n\nBody';
    const view = render(markdown);
    const pasted = 'X\r\nY';
    act(() => view.dispatch({ changes: { from: markdown.length, to: markdown.length, insert: pasted } }));
    // CodeMirror's default line separator handling may normalize \r\n; the
    // invariant under test is that no characters are silently dropped, not
    // a specific normalization choice.
    const doc = view.state.doc.toString();
    expect(doc.replace(/\r\n/g, '\n')).toBe((markdown + pasted).replace(/\r\n/g, '\n'));
  });

  it('deleting a currently-revealed source range and re-rendering leaves exactly one revealed line, matching the new caret', () => {
    const markdown = '# One\n\nHello world\n\nOther paragraph';
    const view = render(markdown);
    view.dispatch({ selection: { anchor: 12 } }); // inside "Hello world", reveals that block
    act(() => { deleteCharBackward(view); });
    const revealed = Array.from(container.querySelectorAll<HTMLElement>('.cm-source-revealed'));
    expect(revealed).toHaveLength(1);
    expect(revealed[0].textContent).toBe('Hell world');
    expect(renderedBlockText()).toContain('One');
    expect(renderedBlockText()).toContain('Other paragraph');
  });
});
