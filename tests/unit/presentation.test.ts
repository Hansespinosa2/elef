import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  deleteSlideMarkdown,
  insertSlideMarkdown,
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
