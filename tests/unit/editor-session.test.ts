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
