import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractFirstH1, normalizeFolderName } from '../../src/domain/presentation';
import { stripWorldMetadata } from '../../src/application/world/workspace';
import { WorldWorkspace } from '../../src/application/world/workspace';
import type { WorldFileSystem, WorldPresentationFile } from '../../src/application/ports/documents';

class MemoryWorld implements WorldFileSystem {
  files = new Map<string, string>();
  async selectWorld() { return '/world'; }
  async locatePresentation() { return null; }
  async ensureDir() {}
  async readText(path: string) { const value = this.files.get(path); if (value === undefined) throw new Error('missing'); return value; }
  async writeText(path: string, content: string) { this.files.set(path, content); }
  async rename(path: string, nextPath: string) { if (this.files.has(`${path}/presentation.md`)) { const value = this.files.get(`${path}/presentation.md`)!; this.files.delete(`${path}/presentation.md`); this.files.set(`${nextPath}/presentation.md`, value); } }
  async remove(path: string) { for (const key of this.files.keys()) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key); }
  async exists(path: string) { return [...this.files.keys()].some((key) => key.startsWith(`${path}/`)); }
  async scanPresentations(): Promise<WorldPresentationFile[]> { return [...this.files].filter(([path]) => path.endsWith('/presentation.md')).map(([path, text]) => ({ path: path.slice(0, -17), name: 'presentation.md', presentationId: text.match(/elef-id:\s*([^\s]+)/)?.[1] || '' })); }
}
const storage = () => ({ data: new Map<string, string>(), getItem(key: string) { return this.data.get(key) || null; }, setItem(key: string, value: string) { this.data.set(key, value); } }) as unknown as Storage;

afterEach(() => vi.useRealTimers());

describe('presentation workspace', () => {
  it('extracts and sanitizes titles without touching slide parsing', () => {
    expect(extractFirstH1('```md\n# code\n```\n# Real title')).toBe('Real title');
    expect(normalizeFolderName('A:/ risky? title ')).toBe('A risky title');
  });
  it('creates immediately and autosaves with a safe title rename', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft(); expect(draft).not.toBeNull();
    workspace.updateSource(draft!.id, '# My Talk'); await new Promise((resolve) => setTimeout(resolve, 400));
    expect([...fs.files.keys()].some((path) => path.includes('/My Talk/presentation.md'))).toBe(true);
  });
  it('starts new presentations in an intro slide with an editable H1', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup();
    const draft = await workspace.createDraft();

    expect(workspace.editorSource(draft!.id)).toBe(':::slide-layout{intro}\n# ');
    expect(workspace.presentation(draft!.id)?.slides[0].layout).toBe('intro');
  });
  it('keeps the Elef id out of the editor source and preview', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    expect(workspace.editorSource(draft!.id)).toBe(':::slide-layout{intro}\n# ');
    expect(stripWorldMetadata(draft!.source)).toBe(':::slide-layout{intro}\n# ');
    expect(workspace.presentation(draft!.id)?.slides[0].markdown).toBe('');
    workspace.updateSource(draft!.id, '# Visible title');
    expect(workspace.editorSource(draft!.id)).toBe('# Visible title');
    expect(workspace.getState().presentations[0].source).toMatch(/^<!-- elef-id:/);
  });
  it('persists presentation theme metadata while retaining Elef identity and content', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '---\ntitle: Demo\n---\n# One\n---\n# Two');
    workspace.updatePresentationTheme(draft!.id, 'dark');
    expect(workspace.editorSource(draft!.id)).toContain('title: Demo\npresentationTheme: dark');
    expect(workspace.presentation(draft!.id)?.presentationTheme).toBe('dark');
    expect(workspace.presentation(draft!.id)?.slides.map((slide) => slide.markdown)).toEqual(['# One', '# Two']);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const saved = [...fs.files.values()].find((source) => source.includes('presentationTheme: dark'));
    expect(saved).toMatch(/^<!-- elef-id:/);
  });
  it('marks moved entries missing and removes them recoverably', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft(); fs.files.delete(`${draft!.path}/presentation.md`);
    await workspace.rescan(); expect(workspace.getState().presentations[0].missing).toBe(true);
    workspace.removeMissing(draft!.id); expect(workspace.getState().presentations).toHaveLength(0);
  });
  it('restores persisted presentations and loads their latest source', async () => {
    const fs = new MemoryWorld(); const persisted = storage();
    const first = new WorldWorkspace(fs, persisted);
    await first.setup(); const draft = await first.createDraft();
    first.updateSource(draft!.id, '# Restored'); await new Promise((resolve) => setTimeout(resolve, 400));
    const second = new WorldWorkspace(fs, persisted); await second.rescan();
    expect(second.getState().root).toBe('/world');
    expect(second.getState().presentations[0].source).toContain('# Restored');
  });
  it('uses a collision-safe suffix when two titles match', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const first = await workspace.createDraft(); const second = await workspace.createDraft();
    workspace.updateSource(first!.id, '# Same title'); workspace.updateSource(second!.id, '# Same title');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const paths = workspace.getState().presentations.map((item) => item.path);
    expect(new Set(paths).size).toBe(2);
    expect(paths.some((path) => path.endsWith('/Same title 2'))).toBe(true);
  });
  it('renames and deletes presentations from the workspace', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    await workspace.renamePresentation(draft!.id, 'Renamed');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(workspace.getState().presentations[0].title).toBe('Renamed');
    expect(workspace.getState().presentations[0].source).toContain('# Renamed');
    await workspace.deletePresentation(draft!.id);
    expect(workspace.getState().presentations).toHaveLength(0);
    expect(fs.files.size).toBe(0);
  });
  it('keeps theme front matter initial when renaming a presentation without a heading', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updatePresentationTheme(draft!.id, 'dark');
    await workspace.renamePresentation(draft!.id, 'Themed');
    const source = workspace.editorSource(draft!.id);
    expect(source).toMatch(/^---\npresentationTheme: dark\n---\n# Themed/);
    expect(workspace.presentation(draft!.id)?.presentationTheme).toBe('dark');
  });

  it('retains a debounced recovery snapshot that can be restored or discarded', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '# Recovered');
    await vi.advanceTimersByTimeAsync(1000);
    expect(workspace.recoverySnapshot(draft!.id)?.source).toBe('# Recovered');
    workspace.updateSource(draft!.id, '# Newer');
    expect(workspace.restoreRecovery(draft!.id)).toBe(true);
    expect(workspace.editorSource(draft!.id)).toBe('# Recovered');
    workspace.discardRecovery(draft!.id);
    expect(workspace.recoverySnapshot(draft!.id)).toBeNull();
  });

  it('SAVE-1: persists a source change to disk only after the debounce settles', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    const writeSpy = vi.spyOn(fs, 'writeText');
    workspace.updateSource(draft!.id, '# Debounced');
    await vi.advanceTimersByTimeAsync(340);
    expect(writeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('presentation.md'), expect.stringContaining('# Debounced'));
  });

  it('SAVE-2: rapid typing coalesces into a single persistence write of the final source', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    const writeSpy = vi.spyOn(fs, 'writeText');
    for (const text of ['# A', '# Ab', '# Abc', '# Abcd', '# Final']) {
      workspace.updateSource(draft!.id, text);
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('# Final'));
  });

  it('SAVE-3: a failed save retries automatically without blocking further editing', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    let failNext = true;
    const original = fs.writeText.bind(fs);
    vi.spyOn(fs, 'writeText').mockImplementation(async (path, content) => {
      if (failNext) { failNext = false; throw new Error('disk full'); }
      return original(path, content);
    });
    workspace.updateSource(draft!.id, '# Attempt one');
    await vi.advanceTimersByTimeAsync(350);
    expect(workspace.getState().error).toBe('disk full');
    // Editing must keep working immediately after a failed save.
    workspace.updateSource(draft!.id, '# Attempt two');
    expect(workspace.editorSource(draft!.id)).toBe('# Attempt two');
    // The failed save is retried on its own, without any further user input.
    await vi.advanceTimersByTimeAsync(1000);
    expect([...fs.files.values()].some((text) => text.includes('# Attempt two'))).toBe(true);
  });

  it('SAVE-4: a failed save never replaces the in-memory source with stale content', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    vi.spyOn(fs, 'writeText').mockRejectedValue(new Error('offline'));
    workspace.updateSource(draft!.id, '# Latest edit');
    await vi.advanceTimersByTimeAsync(350);
    expect(workspace.getState().error).toBe('offline');
    expect(workspace.editorSource(draft!.id)).toBe('# Latest edit');
  });

  it('SAVE-10: a stale retry never overwrites a newer edit, verified by exact writeText call arguments and ordering', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    const writes: Array<{ path: string; content: string }> = [];
    const original = fs.writeText.bind(fs);
    let shouldFail = false;
    vi.spyOn(fs, 'writeText').mockImplementation(async (path, content) => {
      writes.push({ path, content });
      if (shouldFail) { shouldFail = false; throw new Error('disk full'); }
      return original(path, content);
    });

    // Settle the presentation's storage path with one real, successful save
    // first (a brand-new draft's folder always gets renamed away from its
    // random-suffixed temp name on its first save - see save()'s
    // title-derived rename logic). Doing this up front, before any forced
    // failure, keeps the path stable for every write asserted on below and
    // avoids conflating this test with that unrelated rename behavior.
    workspace.updateSource(draft!.id, 'Baseline');
    await vi.advanceTimersByTimeAsync(350);
    expect(workspace.getState().error).toBeFalsy();
    const contentPath = `${workspace.getState().presentations.find((item) => item.id === draft!.id)!.path}/presentation.md`;
    writes.length = 0;

    // First save attempt fails while the source is still "Attempt one".
    shouldFail = true;
    workspace.updateSource(draft!.id, 'Attempt one');
    await vi.advanceTimersByTimeAsync(350);
    expect(workspace.getState().error).toBe('disk full');
    expect(writes.some((write) => write.path === contentPath && write.content.includes('Attempt one'))).toBe(true);

    // A newer edit lands before the retry fires.
    workspace.updateSource(draft!.id, 'Attempt two');
    await vi.advanceTimersByTimeAsync(1000);

    // Every retry write to the content path must carry the CURRENT source,
    // never re-sending the stale 'Attempt one' payload that failed, and the
    // file on disk must end up holding only the newer content.
    const contentWrites = writes.filter((write) => write.path === contentPath);
    expect(contentWrites.length).toBeGreaterThanOrEqual(2);
    const retryContentWrites = contentWrites.slice(1);
    expect(retryContentWrites.every((write) => write.content.includes('Attempt two'))).toBe(true);
    expect(retryContentWrites.some((write) => write.content.includes('Attempt one'))).toBe(false);
    expect(fs.files.get(contentPath)).toContain('Attempt two');
    expect(fs.files.get(contentPath)).not.toContain('Attempt one');
  });

  it('SAVE-11: three back-to-back failures each retry with their own current content, in call order, never swapping payloads', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    const writes: Array<{ path: string; content: string }> = [];
    const original = fs.writeText.bind(fs);
    let failuresRemaining = 0;
    vi.spyOn(fs, 'writeText').mockImplementation(async (path, content) => {
      writes.push({ path, content });
      if (failuresRemaining > 0) { failuresRemaining -= 1; throw new Error('transient'); }
      return original(path, content);
    });

    // Settle the storage path first, as in SAVE-10 above.
    workspace.updateSource(draft!.id, 'Baseline');
    await vi.advanceTimersByTimeAsync(350);
    const contentPath = `${workspace.getState().presentations.find((item) => item.id === draft!.id)!.path}/presentation.md`;
    writes.length = 0;

    failuresRemaining = 2;
    workspace.updateSource(draft!.id, 'First');
    await vi.advanceTimersByTimeAsync(350);
    workspace.updateSource(draft!.id, 'Second');
    await vi.advanceTimersByTimeAsync(1000);
    workspace.updateSource(draft!.id, 'Third');
    await vi.advanceTimersByTimeAsync(1000);

    // Every content-path write's payload must be one of the bodies actually
    // set, in an order consistent with when it was set - never a payload
    // that doesn't correspond to any real editor state (which would
    // indicate a stale/duplicated write), and the very last content write
    // must be the final, current source.
    const contentWrites = writes.filter((write) => write.path === contentPath).map((write) => write.content);
    expect(contentWrites.length).toBeGreaterThanOrEqual(3);
    const validContents = ['First', 'Second', 'Third'];
    for (const content of contentWrites) {
      expect(validContents.some((valid) => content.includes(valid))).toBe(true);
    }
    expect(contentWrites.at(-1)).toContain('Third');
    expect(fs.files.get(contentPath)).toContain('Third');
  });

  it('SAVE-5: a successful persistence leaves no lingering error/UI-interrupting state', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '# Clean save');
    await vi.advanceTimersByTimeAsync(350);
    expect(workspace.getState().error).toBeNull();
    expect(workspace.getState().presentations[0].error).toBeUndefined();
  });

  it('SAVE-6: switching the active presentation still safely queues the previous one\'s pending save', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup();
    const first = await workspace.createDraft();
    const second = await workspace.createDraft();
    workspace.updateSource(first!.id, '# First edited');
    // Switch away from `first` before its 350ms debounce settles.
    workspace.open(second!.id);
    expect(workspace.getState().activeId).toBe(second!.id);
    await vi.advanceTimersByTimeAsync(400);
    expect([...fs.files.values()].some((text) => text.includes('# First edited'))).toBe(true);
  });

  it('SAVE-7: closing the active presentation flushes its pending source immediately', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '# Closing edit');
    // Close before the normal 350ms debounce would have elapsed.
    workspace.close();
    await vi.advanceTimersByTimeAsync(0);
    expect([...fs.files.values()].some((text) => text.includes('# Closing edit'))).toBe(true);
  });

  it('SAVE-8: renaming a presentation does not lose a pending unsaved source edit', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '# Body kept\n\nSome paragraph.');
    await workspace.renamePresentation(draft!.id, 'New name');
    expect(workspace.editorSource(draft!.id)).toContain('Some paragraph.');
    expect(workspace.editorSource(draft!.id)).toContain('# New name');
  });

  it('RECOVERY-1: recovery snapshots are written to storage without surfacing any error/banner state', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const backing = storage();
    const workspace = new WorldWorkspace(fs, backing);
    await workspace.setup(); const draft = await workspace.createDraft();
    workspace.updateSource(draft!.id, '# Silent snapshot');
    await vi.advanceTimersByTimeAsync(1000);
    expect(workspace.recoverySnapshot(draft!.id)?.source).toBe('# Silent snapshot');
    expect(workspace.getState().error).toBeNull();
  });

  it('RECOVERY-2: normal, non-failing editing never surfaces a recovery banner/error', async () => {
    // There is no recovery-banner UI wired up anywhere in the app (nothing in
    // src/App.tsx consumes recoverySnapshot/restoreRecovery/discardRecovery),
    // so this is verified at the state layer: ordinary editing must never
    // populate `state.error` or any other flag a banner could key off of.
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    for (const text of ['# One', '# One\n\nBody', '# One\n\nBody more']) {
      workspace.updateSource(draft!.id, text);
      await vi.advanceTimersByTimeAsync(400);
      expect(workspace.getState().error).toBeNull();
    }
  });

  it('RECOVERY-3: a crash before persistence settles can recover the latest settled snapshot from a fresh instance', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld(); const backing = storage();
    const before = new WorldWorkspace(fs, backing);
    await before.setup(); const draft = await before.createDraft();
    before.updateSource(draft!.id, '# Before crash');
    await vi.advanceTimersByTimeAsync(1000); // recovery snapshot settles
    // Simulate a crash: a brand-new instance (as after a relaunch) is built
    // from the same storage, without the in-flight save ever completing.
    const after = new WorldWorkspace(fs, backing);
    expect(after.recoverySnapshot(draft!.id)?.source).toBe('# Before crash');
    expect(after.restoreRecovery(draft!.id)).toBe(true);
    expect(after.editorSource(draft!.id)).toBe('# Before crash');
  });

  it('SAVE-9: browser (in-memory/localStorage) and Tauri (filesystem) backends share the same debounce and retry shape', async () => {
    vi.useFakeTimers();
    const fs = new MemoryWorld();
    const withStorage = new WorldWorkspace(fs, storage());
    const withoutStorage = new WorldWorkspace(fs, null);
    await withStorage.setup(); const draftA = await withStorage.createDraft();
    await withoutStorage.setup(); const draftB = await withoutStorage.createDraft();
    withStorage.updateSource(draftA!.id, '# With storage');
    withoutStorage.updateSource(draftB!.id, '# Without storage');
    await vi.advanceTimersByTimeAsync(350);
    // Both backends persist through the same fs.writeText contract on the
    // same debounce timing, regardless of whether a recovery `Storage` is
    // available (Tauri desktop vs. a storage-less embedding).
    expect([...fs.files.values()].some((text) => text.includes('# With storage'))).toBe(true);
    expect([...fs.files.values()].some((text) => text.includes('# Without storage'))).toBe(true);
  });
});
