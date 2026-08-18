import { describe, expect, it } from 'vitest';
import { extractFirstH1, normalizeFolderName } from '../../src/domain/presentation';
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
  async exists(path: string) { return [...this.files.keys()].some((key) => key.startsWith(`${path}/`)); }
  async scanPresentations(): Promise<WorldPresentationFile[]> { return [...this.files].filter(([path]) => path.endsWith('/presentation.md')).map(([path, text]) => ({ path: path.slice(0, -17), name: 'presentation.md', presentationId: text.match(/elef-id:\s*([^\s]+)/)?.[1] || '' })); }
}
const storage = () => ({ data: new Map<string, string>(), getItem(key: string) { return this.data.get(key) || null; }, setItem(key: string, value: string) { this.data.set(key, value); } }) as unknown as Storage;

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
});
