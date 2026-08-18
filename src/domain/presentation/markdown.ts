import type { Presentation, PresentationTheme, Slide } from './presentation';

interface SourceLine {
  start: number;
  end: number;
  text: string;
  ending: string;
}

interface InitialFrontMatter {
  lines: SourceLine[];
  closingLine: number;
  bodyStart: number;
  eol: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) && match[0]) {
    lines.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
      ending: match[2],
    });
  }
  return lines;
}

function initialFrontMatter(source: string): InitialFrontMatter | null {
  const lines = sourceLines(source);
  if (!lines.length || lines[0].text.replace(/^\uFEFF/, '').trimEnd() !== '---') return null;
  const closingLine = lines.findIndex((line, index) => index > 0 && line.text.trimEnd() === '---');
  if (closingLine < 0) return null;
  const metadataLines = lines.slice(1, closingLine);
  if (!metadataLines.some((line) => /^[A-Za-z_][\w-]*\s*:/.test(line.text))) return null;
  const eol = lines.find((line) => line.ending)?.ending || '\n';
  return { lines, closingLine, bodyStart: lines[closingLine].end, eol };
}

function normalizeThemeValue(value: string): PresentationTheme {
  const withoutComment = value.trim().replace(/\s+#.*$/, '').trim();
  const unquoted = withoutComment.match(/^(['"])(.*)\1$/)?.[2] ?? withoutComment;
  return unquoted === 'light' || unquoted === 'dark' || unquoted === 'match' ? unquoted : 'match';
}

export function presentationThemeFromSource(source: string): PresentationTheme {
  const frontMatter = initialFrontMatter(source);
  if (!frontMatter) return 'match';
  for (const line of frontMatter.lines.slice(1, frontMatter.closingLine)) {
    const match = line.text.match(/^presentationTheme\s*:\s*(.*)$/);
    if (match) return normalizeThemeValue(match[1]);
  }
  return 'match';
}

export function setPresentationTheme(source: string, theme: PresentationTheme): string {
  const frontMatter = initialFrontMatter(source);
  const property = `presentationTheme: ${theme}`;
  if (!frontMatter) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    return `---${eol}${property}${eol}---${eol}${source}`;
  }

  const themeLines = frontMatter.lines
    .slice(1, frontMatter.closingLine)
    .filter((line) => /^presentationTheme\s*:/.test(line.text));
  if (!themeLines.length) {
    const closing = frontMatter.lines[frontMatter.closingLine];
    return `${source.slice(0, closing.start)}${property}${frontMatter.eol}${source.slice(closing.start)}`;
  }

  const [first, ...duplicates] = themeLines;
  let updated = `${source.slice(0, first.start)}${property}${first.ending || frontMatter.eol}${source.slice(first.end)}`;
  let removed = first.end - first.start - (property.length + (first.ending || frontMatter.eol).length);
  for (const duplicate of duplicates) {
    const start = duplicate.start - removed;
    const length = duplicate.end - duplicate.start;
    updated = updated.slice(0, start) + updated.slice(start + length);
    removed += length;
  }
  return updated;
}

function isFenceStart(line: string): { marker: string; length: number } | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function markdownSections(source: string): { prefix: string; sections: string[] } {
  const frontMatter = initialFrontMatter(source);
  const prefix = frontMatter ? source.slice(0, frontMatter.bodyStart) : '';
  const content = frontMatter ? source.slice(frontMatter.bodyStart) : source;
  const sections: string[] = [];
  let section: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) {
      fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence;
    }
    if (!fence && /^---[ \t]*$/.test(line)) {
      sections.push(section.join('\n'));
      section = [];
    } else {
      section.push(line);
    }
  }
  sections.push(section.join('\n'));
  return { prefix, sections };
}

/** Splits on standalone `---` lines outside fenced code blocks. */
export function parseMarkdown(source: string, sourceName = 'Untitled presentation'): Presentation {
  if (typeof source !== 'string') {
    throw new Error('The selected file did not contain readable text.');
  }

  const frontMatter = initialFrontMatter(source);
  const presentationTheme = presentationThemeFromSource(source);
  const content = frontMatter ? source.slice(frontMatter.bodyStart) : source;
  const normalized = content.replace(/\r\n?/g, '\n');
  const sections: string[] = [];
  let section: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const normalizeSection = (value: string) => value.replace(/^\n/, '').replace(/\n$/, '');

  for (const line of normalized.split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) {
      fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence;
    }

    if (!fence && /^---[ \t]*$/.test(line)) {
      sections.push(normalizeSection(section.join('\n')));
      section = [];
      continue;
    }

    section.push(line);
  }
  sections.push(normalizeSection(section.join('\n')));

  const slides: Slide[] = sections.map((markdown, index) => ({
    id: `${sourceName}-${index + 1}`,
    index,
    markdown,
  }));

  return { sourceName, presentationTheme, slides };
}

export function replaceSlideMarkdown(source: string, slideIndex: number, markdown: string): string {
  const { prefix, sections } = markdownSections(source);
  if (slideIndex < 0 || slideIndex >= sections.length) return source;
  sections[slideIndex] = markdown;
  return `${prefix}${sections.join('\n---\n')}`;
}

export function splitSlideMarkdown(source: string, slideIndex: number): string | null {
  const { prefix, sections } = markdownSections(source);
  const current = sections[slideIndex];
  if (current === undefined) return null;
  const pieces: string[] = [];
  let piece: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of current.split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) {
      fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence;
    }
    if (!fence && /^\s{0,3}#{1,2}\s+/.test(line) && piece.length) {
      pieces.push(piece.join('\n').trim());
      piece = [];
    }
    piece.push(line);
  }
  pieces.push(piece.join('\n').trim());
  if (pieces.length < 2) return null;
  sections.splice(slideIndex, 1, ...pieces);
  return `${prefix}${sections.join('\n---\n')}`;
}

export function extractFirstH1(source: string): string | null {
  const frontMatter = initialFrontMatter(source);
  const content = frontMatter ? source.slice(frontMatter.bodyStart) : source;
  let fence: { marker: string; length: number } | null = null;
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) { fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence; continue; }
    if (!fence) {
      const match = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

export function upsertFirstH1(source: string, title: string): string {
  const frontMatter = initialFrontMatter(source);
  const contentStart = frontMatter?.bodyStart ?? 0;
  const content = source.slice(contentStart);
  let fence: { marker: string; length: number } | null = null;
  for (const line of sourceLines(content)) {
    const nextFence = isFenceStart(line.text);
    if (nextFence) {
      fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence;
      continue;
    }
    if (!fence && /^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/.test(line.text)) {
      const start = contentStart + line.start;
      const end = contentStart + line.end;
      return `${source.slice(0, start)}# ${title}${line.ending}${source.slice(end)}`;
    }
  }
  const separator = content ? '\n\n' : '';
  return `${source.slice(0, contentStart)}# ${title}${separator}${content}`;
}

export function normalizeFolderName(title: string | null | undefined, fallback = 'Untitled presentation'): string {
  const value = (title || fallback).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  if (!value || value === '.' || value === '..') return fallback;
  return value.slice(0, 120);
}
