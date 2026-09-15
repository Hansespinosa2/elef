import { describe, expect, it } from 'vitest';
import { PresentationEditorSession } from '../../src/application/presentation-editor/session';
import { BrowserDocumentReader } from '../../src/infrastructure/browser/documents';

describe('document adapter workflow', () => {
  it('reads UTF-8 Markdown through the browser reader', async () => {
    const session = new PresentationEditorSession();
    const bytes = new TextEncoder().encode('# Browser');
    await session.open(
      { select: async () => ({ name: 'browser.md', read: async () => bytes.buffer }) },
      new BrowserDocumentReader(),
      { confirm: () => true },
    );
    expect(session.getState().source).toBe('# Browser');
    expect(session.getState().presentation?.slides[0].markdown).toBe('# Browser');
  });
});
