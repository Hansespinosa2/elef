import { describe, expect, it } from 'vitest';
import { PresentationEditorSession } from '../../src/application/presentation-editor/session';
import type { DocumentReader, DocumentSelection, FileSelector, ReplacementConfirmation } from '../../src/application/ports/documents';

const confirmation: ReplacementConfirmation = { confirm: () => true };
const selection = (name: string, text: string): DocumentSelection => ({
  name,
  read: async () => new TextEncoder().encode(text).buffer,
});
const reader: DocumentReader = {
  read: async (document) => new TextDecoder().decode(await document.read()),
};

describe('PresentationEditorSession', () => {
  it('keeps source and derived presentation synchronized during edits', () => {
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    session.updateSource('# One\n---\n# Two');
    expect(session.getState().source).toBe('# One\n---\n# Two');
    expect(session.getState().presentation?.slides).toHaveLength(2);
  });

  it('writes presentation theme metadata through the browser session and marks it dirty', () => {
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    session.updateSource('# One\n---\n# Two');
    session.updatePresentationTheme('dark');
    expect(session.getState().source).toBe('---\npresentationTheme: dark\n---\n# One\n---\n# Two');
    expect(session.getState().presentation?.presentationTheme).toBe('dark');
    expect(session.getState().source).not.toBe(session.getState().baseline);
  });

  it('preserves existing front matter when changing the presentation theme', async () => {
    const session = new PresentationEditorSession();
    const source = '---\ntitle: Demo\npresentationTheme: light\n---\n# One';
    await session.open({ select: async () => selection('demo.md', source) }, reader, confirmation);
    session.updatePresentationTheme('match');
    expect(session.getState().source).toContain('title: Demo\npresentationTheme: match');
    expect(session.getState().presentation?.slides[0].markdown).toBe('# One');
  });

  it('preserves the active document when an open fails', async () => {
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    session.updateSource('# Existing');
    const selector: FileSelector = { select: async () => selection('broken.md', '') };
    const failingReader: DocumentReader = { read: async () => { throw new Error('read failed'); } };
    await session.open(selector, failingReader, confirmation);
    expect(session.getState().source).toBe('# Existing');
    expect(session.getState().error).toBe('read failed');
  });

  it('ignores a stale open after a newer document action', async () => {
    const session = new PresentationEditorSession();
    let resolveSelection!: (value: DocumentSelection) => void;
    const pending: FileSelector = { select: () => new Promise((resolve) => { resolveSelection = resolve; }) };
    const opening = session.open(pending, reader, confirmation);
    session.newDocument(confirmation);
    resolveSelection(selection('old.md', '# Old'));
    await opening;
    expect(session.getState().sourceName).toBe('Untitled presentation');
  });
});
