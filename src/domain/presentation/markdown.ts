import type { Presentation, PresentationTheme, Slide, SlideLayout } from './presentation';

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

const slideLayoutDirective = /^\s{0,3}:::slide-layout\{([^}\s]+)\}[ \t]*$/;

function slideMetadata(markdown: string): { layout: SlideLayout; directive: string | null; content: string } {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const firstContentLine = lines.findIndex((line) => line.trim() !== '');
  if (firstContentLine < 0) return { layout: 'body', directive: null, content: normalized };
  const match = lines[firstContentLine].match(slideLayoutDirective);
  if (!match) return { layout: 'body', directive: null, content: normalized };
  const directive = lines[firstContentLine];
  const layout: SlideLayout = match[1] === 'intro' || match[1] === 'body' ? match[1] : 'body';
  const contentLines = [...lines.slice(0, firstContentLine), ...lines.slice(firstContentLine + 1)];
  if (contentLines[firstContentLine] === '') contentLines.splice(firstContentLine, 1);
  return { layout, directive, content: contentLines.join('\n') };
}

function withSlideMetadata(existing: string, markdown: string): string {
  const existingMetadata = slideMetadata(existing);
  const incoming = slideMetadata(markdown).content;
  return existingMetadata.directive ? `${existingMetadata.directive}\n${incoming}` : incoming;
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

  const slides: Slide[] = sections.map((section, index) => {
    const { layout, content: markdown } = slideMetadata(section);
    return {
    id: `${sourceName}-${index + 1}`,
    index,
    markdown,
    layout,
    };
  });

  return { sourceName, presentationTheme, slides };
}

export function replaceSlideMarkdown(source: string, slideIndex: number, markdown: string): string {
  const { prefix, sections } = markdownSections(source);
  if (slideIndex < 0 || slideIndex >= sections.length) return source;
  sections[slideIndex] = withSlideMetadata(sections[slideIndex], markdown);
  return `${prefix}${sections.join('\n---\n')}`;
}

/** Inserts one blank slide immediately after the requested slide. */
export function insertSlideMarkdown(source: string, slideIndex: number): string {
  const { prefix, sections } = markdownSections(source);
  if (slideIndex < 0 || slideIndex >= sections.length) return source;
  sections.splice(slideIndex + 1, 0, '');
  return `${prefix}${sections.join('\n---\n')}`;
}

/** Deletes a slide while always retaining one editable slide in the document. */
export function deleteSlideMarkdown(source: string, slideIndex: number): string {
  const { prefix, sections } = markdownSections(source);
  if (slideIndex < 0 || slideIndex >= sections.length) return source;
  if (sections.length === 1) sections[0] = '';
  else sections.splice(slideIndex, 1);
  return `${prefix}${sections.join('\n---\n')}`;
}

export function splitSlideAtSeparator(
  source: string,
  slideIndex: number,
  markdown: string,
): string {
  const { prefix, sections } = markdownSections(source);
  if (slideIndex < 0 || slideIndex >= sections.length) return source;

  const pieces: string[] = [];
  let piece: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) {
      fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence;
    }
    if (!fence && /^---[ \t]*$/.test(line)) {
      pieces.push(piece.join('\n').trim());
      piece = [];
    } else {
      piece.push(line);
    }
  }
  pieces.push(piece.join('\n').trim());
  if (pieces.length < 2) return source;
  sections.splice(slideIndex, 1, ...pieces.map((piece, index) => index === 0
    ? withSlideMetadata(sections[slideIndex], piece)
    : piece));
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
  sections.splice(slideIndex, 1, ...pieces.map((piece, index) => index === 0
    ? withSlideMetadata(current, piece)
    : piece));
  return `${prefix}${sections.join('\n---\n')}`;
}

export function slideContentBudget(markdown: string): number {
  let budget = 0;
  let fence = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (/^(`{3,}|~{3,})/.test(trimmed)) {
      if (fence) {
        fence = false;
      } else {
        fence = true;
        budget += 1.5;
      }
    } else if (fence) {
      budget += 1.25;
    } else if (!trimmed) {
      budget += .25;
    } else if (/^#{1}\s+/.test(trimmed)) {
      budget += 4;
    } else if (/^#{2}\s+/.test(trimmed)) {
      budget += 3;
    } else if (/^#{3}\s+/.test(trimmed)) {
      budget += 2;
    } else if (/^!\[.*\]\(.+\)/.test(trimmed)) {
      budget += 4;
    } else if (/^\|.*\|$/.test(trimmed)) {
      budget += 2;
    } else if (/^>\s?/.test(trimmed)) {
      budget += 1.5;
    } else if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
      budget += 1;
    } else {
      budget += 1;
    }
  }
  return budget;
}

export function isSlideOverBudget(markdown: string): boolean {
  return slideContentBudget(markdown) > 18;
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
