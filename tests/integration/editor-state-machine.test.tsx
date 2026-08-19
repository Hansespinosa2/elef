// @vitest-environment jsdom
//
// Seeded randomized state-machine coverage. This replays real user-shaped
// action sequences (type / backspace / delete-forward / undo / redo /
// add-slide / delete-slide / preview-split-confirm / preview-split-cancel)
// against a live PresentationPreview + its real, persistent CodeMirror
// EditorView (add/delete/split are driven through the actual DOM buttons
// PresentationEditor.tsx renders, not synthetic domain calls), and after
// EVERY single step asserts the structural invariants a jank regression
// would actually break: valid selection bounds, parseMarkdown never
// throwing, no widget-only markup leaking into the source, and no
// duplication/loss of slide delimiters. Seeds are fixed (never Date.now())
// so a failure is 100% reproducible; on any failed invariant, the
// diagnostic includes the last several actions plus their before/after
// doc snapshots.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { deleteCharBackward, deleteCharForward, redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { PresentationPreview } from '../../src/components/PresentationPreview';
import { parseMarkdown, slideSourceRanges } from '../../src/domain/presentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, maxExclusive: number): number {
  return Math.min(maxExclusive - 1, Math.floor(rng() * maxExclusive));
}

// A deliberately "structurally dangerous" character set: plain letters plus
// the characters that matter to the parser (delimiter dashes, fence
// backticks, heading hashes, blank lines) so random edits actually exercise
// delimiter/fence/heading formation and breakage, not just prose noise.
const RANDOM_CHARS = 'abcXYZ 012#*`-\n';

const INITIAL_MARKDOWN = [
  '# Deck title',
  '',
  'Intro body text.',
  '---',
  '## A splittable slide',
  ...Array.from({ length: 10 }, (_, i) => `Line number ${i} of filler content to push this slide over budget.`),
  '## Another section',
  ...Array.from({ length: 6 }, (_, i) => `More filler line ${i}.`),
  '---',
  '# Closing slide',
  'Short body.',
].join('\n');

// Nothing the live-preview widget layer renders (buttons, ARIA labels,
// widget classes) should ever leak into the CodeMirror *document* itself -
// that would mean a widget's DOM got mistaken for editable text somewhere.
const FORBIDDEN_SUBSTRINGS = [
  'data-slide-action', 'cm-slide-boundary', 'slide-add-button', 'slide-delete-button',
  'slide-split-button', 'slide-boundary-label', 'cm-rendered-block', 'cm-source-revealed',
  '<button', 'aria-label', 'undefined', 'NaN',
];

interface LogEntry { step: number; action: string; before: string; after: string }

describe('Randomized state-machine sequence: click/edit/undo/preview transitions never corrupt the source', () => {
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
    return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
  }

  function diagnostic(log: LogEntry[]): string {
    return `Action log (most recent last):\n${log.slice(-8).map((entry) => (
      `#${entry.step} ${entry.action}\n  before: ${JSON.stringify(entry.before)}\n  after:  ${JSON.stringify(entry.after)}`
    )).join('\n')}`;
  }

  function assertInvariants(log: LogEntry[], view: EditorView) {
    const message = diagnostic(log);
    const doc = view.state.doc.toString();

    for (const range of view.state.selection.ranges) {
      expect(range.from, message).toBeGreaterThanOrEqual(0);
      expect(range.from, message).toBeLessThanOrEqual(range.to);
      expect(range.to, message).toBeLessThanOrEqual(doc.length);
    }

    expect(() => parseMarkdown(doc), message).not.toThrow();
    expect(parseMarkdown(doc).slides.length, message).toBeGreaterThanOrEqual(1);

    // slideSourceRanges' own slide count must always equal the real
    // delimiter-line count + 1: the structural "no duplication/loss of a
    // slide boundary" check, re-derived fresh from the document every step
    // (not tracked incrementally, so it can't drift from reality).
    const ranges = slideSourceRanges(doc);
    const delimiterCount = ranges.filter((range) => range.delimiterStart !== null).length;
    expect(ranges.length, message).toBe(delimiterCount + 1);

    for (const needle of FORBIDDEN_SUBSTRINGS) {
      expect(doc, message).not.toContain(needle);
    }
  }

  function runSequence(seed: number, steps: number) {
    const rng = mulberry32(seed);
    const view = render(INITIAL_MARKDOWN);
    const log: LogEntry[] = [];

    for (let step = 0; step < steps; step += 1) {
      const before = view.state.doc.toString();
      const roll = rng();
      let action = 'noop (no eligible target for the rolled action)';

      act(() => {
        if (roll < 0.28) {
          action = 'type';
          const at = randInt(rng, view.state.doc.length + 1);
          const char = RANDOM_CHARS[randInt(rng, RANDOM_CHARS.length)];
          view.dispatch({ changes: { from: at, to: at, insert: char }, selection: { anchor: at + char.length } });
        } else if (roll < 0.46) {
          action = 'backspace';
          const at = randInt(rng, view.state.doc.length + 1);
          view.dispatch({ selection: { anchor: at } });
          deleteCharBackward(view);
        } else if (roll < 0.58) {
          action = 'delete-forward';
          const at = randInt(rng, view.state.doc.length + 1);
          view.dispatch({ selection: { anchor: at } });
          deleteCharForward(view);
        } else if (roll < 0.72) {
          action = 'undo';
          undo(view);
        } else if (roll < 0.82) {
          action = 'redo';
          redo(view);
        } else if (roll < 0.88) {
          const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-add-button'));
          if (buttons.length) {
            action = 'add-slide';
            buttons[randInt(rng, buttons.length)].click();
          }
        } else if (roll < 0.94) {
          const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-delete-button'));
          if (buttons.length) {
            action = 'delete-slide';
            buttons[randInt(rng, buttons.length)].click();
          }
        } else {
          const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-split-button'));
          if (buttons.length) {
            buttons[randInt(rng, buttons.length)].click();
            const dialogButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.slide-split-preview button'));
            const confirm = rng() < 0.5;
            const target = dialogButtons.find((button) => button.textContent === (confirm ? 'Confirm split' : 'Cancel'));
            target?.click();
            action = confirm ? 'preview-split-confirm' : 'preview-split-cancel';
          }
        }
      });

      const after = view.state.doc.toString();
      log.push({ step, action, before, after });
      assertInvariants(log, view);
    }
  }

  it.each([
    { seed: 1, steps: 40 },
    { seed: 42, steps: 40 },
    { seed: 123456789, steps: 40 },
  ])('seed=$seed: $steps randomized transitions never corrupt source, selection, or slide ranges', ({ seed, steps }) => {
    runSequence(seed, steps);
  });

  it('a fixed seed reproduces byte-identical final source across two independent runs (determinism check)', () => {
    const seed = 987654321;
    const runOnce = () => {
      const view = render(INITIAL_MARKDOWN);
      runSequenceOnExistingView(view, seed, 25);
      const result = view.state.doc.toString();
      act(() => root.unmount());
      container.remove();
      return result;
    };
    function runSequenceOnExistingView(view: EditorView, s: number, n: number) {
      const rng = mulberry32(s);
      for (let step = 0; step < n; step += 1) {
        const roll = rng();
        act(() => {
          if (roll < 0.5) {
            const at = randInt(rng, view.state.doc.length + 1);
            view.dispatch({ changes: { from: at, to: at, insert: RANDOM_CHARS[randInt(rng, RANDOM_CHARS.length)] } });
          } else if (roll < 0.75) {
            const at = randInt(rng, view.state.doc.length + 1);
            view.dispatch({ selection: { anchor: at } });
            deleteCharBackward(view);
          } else {
            undo(view);
          }
        });
      }
    }
    const first = runOnce();
    const second = runOnce();
    expect(second).toBe(first);
  });
});
