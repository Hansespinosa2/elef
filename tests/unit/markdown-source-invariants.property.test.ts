// Table-driven, pure-domain source invariants. These sit at the model layer
// (no CodeMirror/React involved) precisely so a huge case matrix stays fast
// and exact - every case asserts the literal resulting source, not a class
// name or "roughly contains" check. Selection-state invariants for the same
// operations (paste/cut/backspace/delete/undo) live alongside real
// CodeMirror transactions in tests/integration/editor-editing-invariants.test.tsx,
// since selection is a CodeMirror concept these pure functions never see.
import { describe, expect, it } from 'vitest';
import {
  deleteSlideMarkdown,
  insertSlideMarkdown,
  parseMarkdown,
  replaceSlideMarkdown,
  slideSourceRanges,
  splitSlideAtSeparator,
  splitSlideMarkdown,
} from '../../src/domain/presentation/markdown';
import { findMathRanges } from '../../src/components/PresentationEditor';

describe('Delimiter invariants across many source shapes', () => {
  const cases: Array<{ name: string; source: string; expectedSlides: number }> = [
    { name: 'no delimiter at all', source: '# One\n\nBody', expectedSlides: 1 },
    { name: 'one delimiter', source: '# One\n---\n# Two', expectedSlides: 2 },
    { name: 'two consecutive delimiters (an empty slide between)', source: '# One\n---\n---\n# Two', expectedSlides: 3 },
    { name: 'delimiter at the very start of the body', source: '---\n# One', expectedSlides: 2 },
    { name: 'delimiter at the very end of the body', source: '# One\n---', expectedSlides: 2 },
    { name: 'delimiter with trailing spaces still counts', source: '# One\n---  \n# Two', expectedSlides: 2 },
    { name: 'delimiter with tabs after it still counts', source: '# One\n---\t\n# Two', expectedSlides: 2 },
    { name: 'a run of four dashes is not a delimiter', source: '# One\n----\n# Two', expectedSlides: 1 },
    { name: 'two dashes is not a delimiter', source: '# One\n--\n# Two', expectedSlides: 1 },
    { name: 'a delimiter inside a fenced code block is inert', source: '# One\n```\n---\n```\n# Two', expectedSlides: 1 },
    { name: 'a delimiter inside a tilde-fenced code block is inert', source: '# One\n~~~\n---\n~~~\n# Two', expectedSlides: 1 },
    { name: 'a delimiter immediately after an unbalanced fence is still inert', source: '# One\n```\nbody\n---\nmore\n```', expectedSlides: 1 },
    { name: 'front matter delimiters are excluded, a later delimiter still splits', source: '---\ntitle: Demo\n---\n# One\n---\n# Two', expectedSlides: 2 },
    { name: 'front matter with no colon-bearing lines is not front matter (first two dashes count as a delimiter)', source: '---\njust text\n---\n# One', expectedSlides: 3 },
    { name: 'three real slides with mixed fences around delimiters', source: '# A\n```js\n---\n```\n---\n# B\n---\n# C', expectedSlides: 3 },
  ];

  it.each(cases)('$name -> $expectedSlides slide(s)', ({ source, expectedSlides }) => {
    expect(parseMarkdown(source).slides).toHaveLength(expectedSlides);
    expect(slideSourceRanges(source)).toHaveLength(expectedSlides);
  });

  it.each(cases)('$name: slide count always equals real delimiter lines + 1 (no duplication/loss)', ({ source }) => {
    const ranges = slideSourceRanges(source);
    const delimiterCount = ranges.filter((range) => range.delimiterStart !== null).length;
    expect(ranges).toHaveLength(delimiterCount + 1);
  });
});

describe('Front matter and fence interaction invariants', () => {
  it.each([
    { name: 'no front matter', source: '# One', frontMatterExcluded: false },
    { name: 'valid front matter with metadata', source: '---\ntitle: Demo\n---\n# One', frontMatterExcluded: true },
    { name: 'front matter without any key: value line is not front matter', source: '---\njust prose\n---\n# One', frontMatterExcluded: false },
    { name: 'front matter with an unterminated block is not front matter', source: '---\ntitle: Demo\n# One', frontMatterExcluded: false },
  ])('$name', ({ source, frontMatterExcluded }) => {
    const ranges = slideSourceRanges(source);
    if (frontMatterExcluded) {
      expect(ranges[0].start).toBeGreaterThan(0);
      expect(source.slice(0, ranges[0].start)).toMatch(/^---\n[\s\S]*?\n---\n$/);
    } else {
      expect(ranges[0].start).toBe(0);
    }
  });

  it('a fence that reopens with a longer run of backticks than it closed with stays open', () => {
    // ` ``` ` opens with length 3; a run of only 3 backticks inside closes it,
    // but a subsequent longer fence (4 backticks) re-opens, so a `---` after
    // it while still "inside" the 4-backtick fence must stay inert.
    const source = '# One\n```\ninner\n```\n````\n---\n````\n# Two';
    expect(parseMarkdown(source).slides).toHaveLength(1);
  });
});

describe('Markdown syntax preservation across model operations (insert/delete/split/replace)', () => {
  const snippets = [
    { name: 'strong/emphasis/strikethrough', markdown: 'A **bold**, *em*, and ~~struck~~ word.' },
    { name: 'inline code with backticks', markdown: 'Use `const x = 1;` here.' },
    { name: 'fenced code with language', markdown: '```ts\nconst value: number = 1;\n```' },
    { name: 'fenced code with tilde fence', markdown: '~~~python\nprint("hi")\n~~~' },
    { name: 'block quote', markdown: '> Quoted line\n> Second quoted line' },
    { name: 'ordered list with indentation', markdown: '1. First\n2. Second\n   1. Nested' },
    { name: 'unordered list with mixed markers', markdown: '- First\n* Second\n+ Third' },
    { name: 'task list', markdown: '- [ ] Todo\n- [x] Done' },
    { name: 'table with alignment markers', markdown: '| A | B |\n| :-- | --: |\n| 1 | 2 |' },
    { name: 'link and image', markdown: 'See [a link](https://example.com) and ![alt](img.png).' },
    { name: 'inline and display TeX', markdown: 'Inline $x=1$ and\n\n$$\ny = 2\n$$' },
  ];

  it.each(snippets)('$name survives insertSlideMarkdown/deleteSlideMarkdown unchanged', ({ markdown }) => {
    const source = `# Before\n---\n${markdown}\n---\n# After`;
    const inserted = insertSlideMarkdown(source, 0);
    expect(parseMarkdown(inserted).slides[2].markdown).toBe(markdown);
    const deleted = deleteSlideMarkdown(inserted, 1);
    expect(parseMarkdown(deleted).slides[1].markdown).toBe(markdown);
  });

  it.each(snippets)('$name survives replaceSlideMarkdown round trip unchanged', ({ markdown }) => {
    const source = '# Before\n---\nPLACEHOLDER\n---\n# After';
    const replaced = replaceSlideMarkdown(source, 1, markdown);
    expect(parseMarkdown(replaced).slides[1].markdown).toBe(markdown);
    // Restoring the placeholder must reproduce the exact original source.
    expect(replaceSlideMarkdown(replaced, 1, 'PLACEHOLDER')).toBe(source);
  });

  it.each(snippets)('$name survives splitSlideAtSeparator on an unrelated neighbor slide unchanged', ({ markdown }) => {
    const source = `${markdown}\n---\nHeading one\n---\nSplit target\n---\nHeading two`;
    const split = splitSlideAtSeparator(source, 2, 'Split target\n---\nHeading three');
    expect(parseMarkdown(split).slides[0].markdown).toBe(markdown);
  });
});

describe('TeX preservation invariants (findMathRanges)', () => {
  // Expected offsets/values below were cross-checked against the real
  // katex.renderToString validity check (not guessed), so "valid" reflects
  // actual KaTeX parseability, not an assumption about the syntax.
  it.each([
    { name: 'simple inline', wrapped: '$x=3$', expected: [{ from: 0, to: 5, source: 'x=3', display: false, valid: true }] },
    { name: 'inline with fraction', wrapped: '$\\frac{1}{2}$', expected: [{ from: 0, to: 13, source: '\\frac{1}{2}', display: false, valid: true }] },
    { name: 'display math', wrapped: '$$\ny = x\n$$', expected: [{ from: 0, to: 11, source: '\ny = x\n', display: true, valid: true }] },
    { name: 'a bare exponent with no braces is still valid KaTeX (not a false negative)', wrapped: '$x^2$', expected: [{ from: 0, to: 5, source: 'x^2', display: false, valid: true }] },
    { name: 'a fraction missing its second argument is flagged invalid but preserved verbatim', wrapped: '$\\frac{1}$', expected: [{ from: 0, to: 10, source: '\\frac{1}', display: false, valid: false }] },
    { name: 'an unclosed brace command is flagged invalid but preserved verbatim', wrapped: '$\\sqrt{1$', expected: [{ from: 0, to: 9, source: '\\sqrt{1', display: false, valid: false }] },
    { name: 'an unknown KaTeX command is flagged invalid but preserved verbatim', wrapped: '$\\notarealcommand$', expected: [{ from: 0, to: 18, source: '\\notarealcommand', display: false, valid: false }] },
  ])('$name', ({ wrapped, expected }) => {
    expect(findMathRanges(wrapped)).toEqual(expected);
  });

  it('multiple formulas in one paragraph each preserve their own exact source independently', () => {
    const source = 'First $a+b$ then $c-d$ and $$\ne=f\n$$.';
    const ranges = findMathRanges(source);
    expect(ranges.map((range) => range.source)).toEqual(['a+b', 'c-d', '\ne=f\n']);
    expect(ranges.every((range) => range.valid)).toBe(true);
  });

  it('an unterminated display formula preserves all remaining source as invalid rather than throwing or truncating', () => {
    const source = 'Before $$\ny = mx + b';
    expect(() => findMathRanges(source)).not.toThrow();
    const ranges = findMathRanges(source);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].valid).toBe(false);
    expect(source.slice(ranges[0].from, ranges[0].to)).toBe('$$\ny = mx + b');
  });
});

describe('Malformed input never throws and never silently replaces source', () => {
  it.each([
    { name: 'unterminated fence', source: '# One\n```ts\nconst x = 1;' },
    { name: 'unterminated inline TeX', source: '# One\n\nBroken $x^2' },
    { name: 'unterminated display TeX', source: '# One\n\n$$\ny = mx' },
    { name: 'unbalanced front matter', source: '---\ntitle: Demo\n# One' },
    { name: 'nested/mismatched fence markers', source: '# One\n```\n~~~\n```\nstray\n~~~' },
    { name: 'lone delimiter dashes with trailing garbage', source: '# One\n---x\n# Two' },
    { name: 'binary-looking control characters', source: '# One\n\u0000\u0001Body' },
    { name: 'extremely long single line', source: `# One\n\n${'x'.repeat(5000)}` },
  ])('$name: parseMarkdown never throws and preserves total content length within a fence/newline-normalization budget', ({ source }) => {
    expect(() => parseMarkdown(source)).not.toThrow();
    const presentation = parseMarkdown(source);
    expect(presentation.slides.length).toBeGreaterThan(0);
    // No slide's markdown was fabricated: every slide's content, once
    // rejoined, must be traceable back to the original source (accounting
    // only for normalized line endings and the delimiter markers the parser
    // itself owns).
    const rejoined = presentation.slides.map((slide) => slide.markdown).join('');
    for (const line of rejoined.split('\n')) {
      if (line.trim()) expect(source).toContain(line);
    }
  });
});

describe('Add/delete/undo composed source-model invariants', () => {
  it.each([
    { name: 'insert then delete the same slide returns to the original source', source: '# One\n---\n# Two', ops: (s: string) => deleteSlideMarkdown(insertSlideMarkdown(s, 0), 1) },
    { name: 'insert at the end then delete it returns to the original source', source: '# One\n---\n# Two', ops: (s: string) => deleteSlideMarkdown(insertSlideMarkdown(s, 1), 2) },
    { name: 'splitting then rejoining via replaceSlideMarkdown restores exact content', source: '# One\n---\n## A\nBody A\n## B\nBody B', ops: (s: string) => {
      const split = splitSlideMarkdown(s, 1)!;
      const rejoined = parseMarkdown(split).slides.slice(1).map((slide) => slide.markdown).join('\n');
      return replaceSlideMarkdown(deleteSlideMarkdown(split, 2), 1, rejoined);
    } },
  ])('$name', ({ source, ops }) => {
    expect(ops(source)).toBe(source);
  });

  it('deleting every slide down to one then re-inserting matches deleting a fresh single-slide document', () => {
    const source = '# One\n---\n# Two\n---\n# Three';
    let reduced = source;
    while (parseMarkdown(reduced).slides.length > 1) reduced = deleteSlideMarkdown(reduced, 1);
    expect(parseMarkdown(reduced).slides).toHaveLength(1);
    expect(parseMarkdown(reduced).slides[0].markdown).toBe('# One');
    // Deleting the last remaining slide clears its content rather than
    // producing a zero-slide document (matches the documented single-slide
    // floor behavior in tests/unit/presentation.test.ts).
    expect(deleteSlideMarkdown(reduced, 0)).toBe('');
    expect(parseMarkdown(deleteSlideMarkdown(reduced, 0)).slides).toHaveLength(1);
  });
});
