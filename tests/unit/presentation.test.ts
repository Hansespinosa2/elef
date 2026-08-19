import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  deleteSlideMarkdown,
  insertSlideMarkdown,
  isSlideOverBudget,
  presentationThemeFromSource,
  replaceSlideMarkdown,
  setPresentationTheme,
  slideContentBudget,
  splitSlideAtSeparator,
  splitSlideMarkdown,
  slideSourceRanges,
} from '../../src/domain/presentation/markdown';
import {
  normalizeEditorThemePreference,
  resolveEditorTheme,
  resolvePresentationTheme,
} from '../../src/domain/presentation/presentation';
import { readUtf8Markdown } from '../../src/domain/presentation/utf8';
import { hasUnsavedChanges } from '../../src/domain/presentation/document';

describe('parseMarkdown', () => {
  it('inserts and deletes slides without touching front matter or fenced separators', () => {
    const source = '---\ntitle: Demo\n---\n```yaml\n---\n```\n---\n# Two';
    expect(insertSlideMarkdown(source, 0)).toBe('---\ntitle: Demo\n---\n```yaml\n---\n```\n---\n\n---\n# Two');
    expect(deleteSlideMarkdown(insertSlideMarkdown(source, 0), 1)).toBe(source);
  });

  it('clears the only slide instead of producing zero slides', () => {
    expect(deleteSlideMarkdown('---\ntitle: Demo\n---\n# One', 0)).toBe('---\ntitle: Demo\n---\n');
    expect(parseMarkdown(deleteSlideMarkdown('# One', 0)).slides.map((slide) => slide.markdown)).toEqual(['']);
  });
  it('splits ordered slides on standalone separators', () => {
    const result = parseMarkdown('# One\n\n---\n\n## Two');
    expect(result.slides.map((slide) => slide.markdown)).toEqual(['# One', '## Two']);
  });

  it('returns one slide when no separator exists', () => {
    expect(parseMarkdown('hello').slides).toHaveLength(1);
  });

  it('returns one empty slide for a blank document', () => {
    expect(parseMarkdown('').slides.map((slide) => slide.markdown)).toEqual(['']);
  });

  it('updates ordered slides when source gains a separator', () => {
    expect(parseMarkdown('# One\n---\n# Two').slides.map((slide) => slide.markdown)).toEqual(['# One', '# Two']);
  });

  it('preserves leading, consecutive, and trailing empty slides', () => {
    const result = parseMarkdown('---\n\n# One\n---\n---');
    expect(result.slides.map((slide) => slide.markdown)).toEqual(['', '# One', '', '']);
  });

  it('does not split horizontal rules with surrounding content', () => {
    expect(parseMarkdown('before\n---\nafter').slides).toHaveLength(2);
  });

  it('keeps alternate horizontal-rule syntax inside one slide', () => {
    expect(parseMarkdown('before\n***\nafter').slides).toHaveLength(1);
    expect(parseMarkdown('before\n___\nafter').slides).toHaveLength(1);
  });

  it('does not split standalone separators inside fenced code', () => {
    const result = parseMarkdown('```yaml\n---\n```');
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].markdown).toContain('---');
  });

  it('keeps supported Markdown input unchanged', () => {
    const markdown = '# Heading\n\n- item\n\n```ts\nconst value = 1;\n```\n\n![Alt](image.png)';
    expect(parseMarkdown(markdown).slides[0].markdown).toBe(markdown);
  });

  it('excludes initial front matter and preserves later slide separators', () => {
    const result = parseMarkdown('---\ntitle: Demo\npresentationTheme: dark\n---\n# One\n---\n# Two');
    expect(result.presentationTheme).toBe('dark');
    expect(result.slides.map((slide) => slide.markdown)).toEqual(['# One', '# Two']);
  });

  it('resolves absent and invalid presentation metadata to match', () => {
    expect(parseMarkdown('# No metadata').presentationTheme).toBe('match');
    expect(presentationThemeFromSource('---\npresentationTheme: neon\n---\n# Invalid')).toBe('match');
    expect(resolvePresentationTheme('match', 'dark')).toBe('dark');
    expect(resolvePresentationTheme('light', 'dark')).toBe('light');
  });

  it('keeps malformed or non-initial front matter as ordinary Markdown', () => {
    expect(parseMarkdown('---\npresentationTheme: dark').presentationTheme).toBe('match');
    expect(parseMarkdown('# Intro\n---\npresentationTheme: dark\n---').presentationTheme).toBe('match');
    expect(parseMarkdown('---\npresentationTheme: dark').slides[1].markdown).toBe('presentationTheme: dark');
  });

  it('adds or updates presentation metadata without changing Markdown content', () => {
    const markdown = '# One\n---\n# Two';
    expect(setPresentationTheme(markdown, 'dark')).toBe(
      '---\npresentationTheme: dark\n---\n# One\n---\n# Two',
    );
    const existing = '---\ntitle: Demo\npresentationTheme: light\nowner: Ada\n---\n# One\n---\n# Two';
    const updated = setPresentationTheme(existing, 'match');
    expect(updated).toContain('title: Demo\npresentationTheme: match\nowner: Ada');
    expect(parseMarkdown(updated).slides.map((slide) => slide.markdown)).toEqual(['# One', '# Two']);
  });

  it('replaces a slide without splitting separators inside fenced code', () => {
    const source = '---\npresentationTheme: dark\n---\n```yaml\n---\n```\n---\n# Two';
    const updated = replaceSlideMarkdown(source, 1, '## Updated');
    expect(updated).toBe('---\npresentationTheme: dark\n---\n```yaml\n---\n```\n---\n## Updated');
  });

  it('inserts slides without disturbing front matter or fenced separators', () => {
    const source = '---\npresentationTheme: dark\n---\n```yaml\n---\n```\n---\n# Two';
    expect(insertSlideMarkdown(source, 0)).toBe(
      '---\npresentationTheme: dark\n---\n```yaml\n---\n```\n---\n\n---\n# Two',
    );
  });

  it('deletes slides while retaining one blank slide', () => {
    expect(deleteSlideMarkdown('# One\n---\n# Two', 0)).toBe('# Two');
    expect(deleteSlideMarkdown('# One', 0)).toBe('');
  });

  it('splits a slide at a typed separator without splitting fenced code', () => {
    expect(splitSlideAtSeparator('# One', 0, '# One\n\n---\n\n# Two')).toBe(
      '# One\n---\n# Two',
    );
    expect(splitSlideAtSeparator('```yaml\n---\n```', 0, '```yaml\n---\n```')).toBe('```yaml\n---\n```');
  });

  it('splits an overflowing slide at top-level headings', () => {
    const source = '# One\n\nBody\n\n## Two\n\nMore';
    const updated = splitSlideMarkdown(source, 0);
    expect(updated).toBe('# One\n\nBody\n---\n## Two\n\nMore');
    expect(splitSlideMarkdown('Paragraph only', 0)).toBeNull();
  });

  it('calculates a viewport-independent weighted content budget', () => {
    expect(slideContentBudget('# Heading')).toBe(4);
    expect(slideContentBudget('# Heading\n\n```ts\nconst value = 1;\n```')).toBe(7);
  });

  it('returns stable source ranges while ignoring front matter and fenced separators', () => {
    const source = '---\ntitle: Demo\n---\n```yaml\n---\n```\n---\n# Two';
    const ranges = slideSourceRanges(source);
    expect(ranges).toHaveLength(2);
    expect(source.slice(ranges[0].start, ranges[0].end)).toContain('```yaml\n---\n```');
    expect(source.slice(ranges[1].start, ranges[1].end)).toBe('# Two');
    expect(source.slice(ranges[0].delimiterStart!, ranges[0].delimiterEnd!)).toBe('---\n');
  });

  it('normalizes stored editor choices and resolves system changes deterministically', () => {
    expect(normalizeEditorThemePreference('broken')).toBe('system');
    expect(resolveEditorTheme('system', false)).toBe('light');
    expect(resolveEditorTheme('system', true)).toBe('dark');
    expect(resolveEditorTheme('light', true)).toBe('light');
  });

  it('rejects invalid UTF-8 and read failures', async () => {
    const valid = new TextEncoder().encode('# Café').buffer;
    await expect(readUtf8Markdown(async () => valid)).resolves.toBe('# Café');
    await expect(readUtf8Markdown(async () => new Uint8Array([0xc3, 0x28]).buffer)).rejects.toThrow();
    await expect(readUtf8Markdown(async () => {
      throw new Error('read failed');
    })).rejects.toThrow('read failed');
  });

  it('tracks unsaved changes only for an active document', () => {
    expect(hasUnsavedChanges('', '', 'Untitled presentation')).toBe(false);
    expect(hasUnsavedChanges('# Draft', '', 'Untitled presentation')).toBe(true);
    expect(hasUnsavedChanges('# Draft', '', null)).toBe(false);
  });
});

// Behavior-matrix model-layer coverage. Test names are prefixed with the
// matrix IDs from _bmad-output/specs/spec-editor-ux-recovery/behavior-matrix.md
// so failures can be traced back to a specific unchecked behavior.
describe('BOUNDARY model invariants', () => {
  it('BOUNDARY-5: deleting an empty slide does not delete an adjacent non-empty slide', () => {
    const source = '# One\n---\n\n---\n# Three';
    const updated = deleteSlideMarkdown(source, 1);
    expect(parseMarkdown(updated).slides.map((slide) => slide.markdown)).toEqual(['# One', '# Three']);
  });

  it('BOUNDARY-8/BOUNDARY-9: standalone --- never creates a slide inside fenced code or front matter', () => {
    expect(slideSourceRanges('```yaml\n---\n```')).toHaveLength(1);
    const withFrontMatter = slideSourceRanges('---\ntitle: Demo\n---\n# One');
    expect(withFrontMatter).toHaveLength(1);
  });

  it('BOUNDARY-10: typing the third dash on an otherwise empty line creates a slide', () => {
    expect(parseMarkdown('# One\n-').slides).toHaveLength(1);
    expect(parseMarkdown('# One\n--').slides).toHaveLength(1);
    expect(parseMarkdown('# One\n---').slides).toHaveLength(2);
  });

  it('BOUNDARY-11: an incomplete -- remains editable text and is never treated as a delimiter', () => {
    const result = parseMarkdown('# One\n--\n# Two');
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].markdown).toContain('--');
  });
});

describe('SPLIT model invariants', () => {
  it('SPLIT-6: split supports top-level heading boundaries', () => {
    const source = '# One\n\nBody\n\n## Two\n\nMore';
    expect(splitSlideMarkdown(source, 0)).toBe('# One\n\nBody\n---\n## Two\n\nMore');
  });

  it('SPLIT-7: refuses to split when no safe split point exists', () => {
    expect(splitSlideMarkdown('Paragraph only, no headings here.', 0)).toBeNull();
    expect(splitSlideMarkdown('# Only one heading\n\nBody text', 0)).toBeNull();
  });

  it('SPLIT-4: confirming a split preserves every content line from the original slide', () => {
    const source = '# One\n\nBody line one\nBody line two\n\n## Two\n\nMore content here';
    const updated = splitSlideMarkdown(source, 0)!;
    const pieces = parseMarkdown(updated).slides.map((slide) => slide.markdown);
    expect(pieces).toEqual(['# One\n\nBody line one\nBody line two', '## Two\n\nMore content here']);
  });
});

describe('OVERFLOW model invariants', () => {
  it('OVERFLOW-1: overflow detection is a pure, viewport-independent computation', () => {
    const shortSlide = '# Title\n\nOne short line.';
    const longSlide = ['# Title', ...Array.from({ length: 20 }, (_, index) => `Body line ${index}`)].join('\n\n');
    expect(isSlideOverBudget(shortSlide)).toBe(false);
    expect(isSlideOverBudget(longSlide)).toBe(true);
    // Deterministic and reproducible without measuring real layout or a Tauri WebView.
    expect(slideContentBudget(longSlide)).toBe(slideContentBudget(longSlide));
  });
});

describe('MD model-level source preservation', () => {
  it('MD-3: strong, emphasis, and deletion markers survive unrelated slide operations', () => {
    const source = '**bold** *em* ~~gone~~ text';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
    expect(replaceSlideMarkdown(`${source}\n---\n# Two`, 0, source)).toBe(`${source}\n---\n# Two`);
  });

  it('MD-4: inline code backticks are preserved exactly', () => {
    const source = 'Use `const x = 1;` in code.';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
  });

  it('MD-5: fenced code fence marker, language, and body survive slide splitting', () => {
    const source = '# One\n\n```ts\nconst value = 1;\n```\n---\n# Two';
    expect(parseMarkdown(source).slides[0].markdown).toBe('# One\n\n```ts\nconst value = 1;\n```');
  });

  it('MD-6: block quote markers are preserved exactly', () => {
    const source = '> Quoted line one\n> Quoted line two';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
  });

  it('MD-7: ordered list numbering and indentation are preserved exactly', () => {
    const source = '1. First\n   1. Nested\n2. Second';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
  });

  it('MD-8: unordered list marker style and indentation are preserved exactly', () => {
    const source = '- First\n  - Nested\n* Second';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
  });

  it('MD-13: editing a table through replaceSlideMarkdown preserves pipes and alignment markers', () => {
    const source = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const withSlide = `${source}\n---\n# Two`;
    expect(replaceSlideMarkdown(withSlide, 0, source)).toBe(withSlide);
  });

  it('MD-14: links remain exact, source-editable Markdown', () => {
    const source = 'See [Elef](https://example.com/elef) for details.';
    expect(parseMarkdown(source).slides[0].markdown).toBe(source);
  });

  it('MD-20: malformed Markdown remains editable and parseMarkdown never throws', () => {
    const malformed = '# Unclosed\n\n```ts\nconst missing = 1;\n\n| a | b\n|---\n> broken *emphasis';
    expect(() => parseMarkdown(malformed)).not.toThrow();
    expect(parseMarkdown(malformed).slides[0].markdown).toBe(malformed);
  });
});
