import type { Presentation, Slide } from './presentation';

function isFenceStart(line: string): { marker: string; length: number } | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

/** Splits on standalone `---` lines outside fenced code blocks. */
export function parseMarkdown(source: string, sourceName = 'Untitled presentation'): Presentation {
  if (typeof source !== 'string') {
    throw new Error('The selected file did not contain readable text.');
  }

  const normalized = source.replace(/\r\n?/g, '\n');
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

  return { sourceName, slides };
}

export function extractFirstH1(source: string): string | null {
  let fence: { marker: string; length: number } | null = null;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const nextFence = isFenceStart(line);
    if (nextFence) { fence = fence && fence.marker === nextFence.marker && nextFence.length >= fence.length ? null : nextFence; continue; }
    if (!fence) {
      const match = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*#*\s*$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

export function normalizeFolderName(title: string | null | undefined, fallback = 'Untitled presentation'): string {
  const value = (title || fallback).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  if (!value || value === '.' || value === '..') return fallback;
  return value.slice(0, 120);
}
