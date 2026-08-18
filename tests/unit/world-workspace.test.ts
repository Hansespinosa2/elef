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
  it('keeps the Elef id out of the editor source and preview', async () => {
    const fs = new MemoryWorld(); const workspace = new WorldWorkspace(fs, storage());
    await workspace.setup(); const draft = await workspace.createDraft();
    expect(workspace.editorSource(draft!.id)).toBe('');
    expect(stripWorldMetadata(draft!.source)).toBe('');
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
});
