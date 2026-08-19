// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// This project's jsdom test environment does not wire up a working global
// `localStorage` (Node's experimental built-in shadows jsdom's without a
// `--localstorage-file`), even though real browsers/Tauri webviews always
// provide one. PresentationEditorSession reads/writes it directly via the
// global, so the RECOVERY-*/SAVE-9 tests below install a minimal in-memory
// stand-in for the duration of this file - a test-environment seam, not a
// change to production code or behavior.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
(globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

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

  it('RECOVERY-1: recovery snapshots are written silently to storage after the debounce', () => {
    vi.useFakeTimers();
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    session.updateSource('# Silent snapshot');
    expect(session.recoverySnapshot()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(session.recoverySnapshot()?.source).toBe('# Silent snapshot');
    // Writing the snapshot must not surface any error/banner-like state.
    expect(session.getState().error).toBeNull();
  });

  it('RECOVERY-2: normal, non-failing editing never surfaces a recovery banner/error', () => {
    // No component in src/ consumes recoverySnapshot/restoreRecovery for this
    // browser session either (only WorldWorkspace's Tauri path is wired to a
    // filesystem, and neither exposes a banner). Verified at the state layer:
    // ordinary typing must never populate `state.error`.
    vi.useFakeTimers();
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    for (const text of ['# One', '# One\n\nBody', '# One\n\nBody more']) {
      session.updateSource(text);
      vi.advanceTimersByTime(1000);
      expect(session.getState().error).toBeNull();
    }
  });

  it('RECOVERY-3: a crash before the debounce settles can still recover the latest settled snapshot in a fresh session', () => {
    vi.useFakeTimers();
    const before = new PresentationEditorSession();
    before.newDocument(confirmation);
    before.updateSource('# Before crash');
    vi.advanceTimersByTime(1000); // snapshot settles into localStorage
    // A fresh session instance (as after an app relaunch) reads the same
    // localStorage-backed recovery snapshot from its constructor.
    const after = new PresentationEditorSession();
    expect(after.recoverySnapshot()?.source).toBe('# Before crash');
    expect(after.restoreRecovery(confirmation)).toBe(true);
    expect(after.getState().source).toBe('# Before crash');
  });

  it('SAVE-9: the browser session shares the same debounce-then-silent-persist shape as the Tauri workspace path', () => {
    // Both PresentationEditorSession (browser/local demo mode) and
    // WorldWorkspace (Tauri filesystem mode, see world-workspace.test.ts)
    // debounce edits and settle a snapshot without any synchronous/blocking
    // UI state change - this asserts that shared contract on the browser
    // side specifically (no explicit disk save target exists in this mode,
    // so "persistence" here is the localStorage recovery snapshot).
    vi.useFakeTimers();
    const session = new PresentationEditorSession();
    session.newDocument(confirmation);
    session.updateSource('# A');
    vi.advanceTimersByTime(500);
    session.updateSource('# AB');
    vi.advanceTimersByTime(500);
    expect(session.recoverySnapshot()).toBeNull(); // still coalescing/debouncing
    vi.advanceTimersByTime(500);
    expect(session.recoverySnapshot()?.source).toBe('# AB');
  });
});
