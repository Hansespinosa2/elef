import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdown';
import { readUtf8Markdown } from './file';

describe('parseMarkdown', () => {
  it('splits ordered slides on standalone separators', () => {
    const result = parseMarkdown('# One\n\n---\n\n## Two');
    expect(result.slides.map((slide) => slide.markdown)).toEqual(['# One', '## Two']);
  });

  it('returns one slide when no separator exists', () => {
    expect(parseMarkdown('hello').slides).toHaveLength(1);
  });

  it('preserves leading, consecutive, and trailing empty slides', () => {
    const result = parseMarkdown('---\n\n# One\n---\n---');
    expect(result.slides.map((slide) => slide.markdown)).toEqual(['', '# One', '', '']);
  });

  it('does not split horizontal rules with surrounding content', () => {
    expect(parseMarkdown('before\n---\nafter').slides).toHaveLength(2);
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

  it('rejects invalid UTF-8 and read failures', async () => {
    const valid = new TextEncoder().encode('# Café').buffer;
    await expect(readUtf8Markdown(async () => valid)).resolves.toBe('# Café');
    await expect(readUtf8Markdown(async () => new Uint8Array([0xc3, 0x28]).buffer)).rejects.toThrow();
    await expect(readUtf8Markdown(async () => {
      throw new Error('read failed');
    })).rejects.toThrow('read failed');
  });
});
