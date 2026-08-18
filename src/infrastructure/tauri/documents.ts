import { open } from '@tauri-apps/api/dialog';
import { createDir, exists, readBinaryFile, readDir, readTextFile, renameFile, writeTextFile } from '@tauri-apps/api/fs';
import type { DocumentReader, DocumentSelection, FileSelector, WorldFileSystem, WorldPresentationFile } from '../../application/ports/documents';
import { readUtf8Markdown } from '../../domain/presentation/utf8';

export class TauriFileSelector implements FileSelector {
  async select(): Promise<DocumentSelection | null> {
    const selected = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (typeof selected !== 'string') return null;
    return {
      name: selected.split(/[\\/]/).pop() || selected,
      read: async () => Uint8Array.from(await readBinaryFile(selected)).buffer,
    };
  }
}

export class TauriDocumentReader implements DocumentReader {
  async read(selection: DocumentSelection): Promise<string> {
    try {
      return await readUtf8Markdown(selection.read);
    } catch {
      throw new Error('Could not read the selected file. Select a UTF-8 Markdown file and try again.');
    }
  }
}

export class TauriWorldFileSystem implements WorldFileSystem {
      async selectWorld(): Promise<string | null> {
        const selected = await open({ directory: true, multiple: false });
        return typeof selected === 'string' ? selected : null;
      }
      async locatePresentation(): Promise<string | null> {
        const selected = await open({ directory: false, multiple: false, filters: [{ name: 'Elef presentation', extensions: ['md'] }] });
        return typeof selected === 'string' ? selected : null;
      }
      async ensureDir(path: string) { await createDir(path, { recursive: true }); }
      async readText(path: string) { return readTextFile(path); }
      async writeText(path: string, content: string) { await writeTextFile(path, content); }
      async rename(path: string, nextPath: string) { await renameFile(path, nextPath); }
    async exists(path: string) { return exists(path); }
    async scanPresentations(root: string): Promise<WorldPresentationFile[]> {
      const found: WorldPresentationFile[] = [];
      const visit = async (entries: Awaited<ReturnType<typeof readDir>>): Promise<void> => {
        for (const entry of entries) {
          if (entry.children) { await visit(entry.children); continue; }
          if (entry.name !== 'presentation.md') continue;
          const text = await readTextFile(entry.path);
          const match = text.match(/<!--\s*elef-id:\s*([a-zA-Z0-9_-]+)\s*-->/);
          if (match) found.push({ path: entry.path.replace(/[\\/]+presentation\.md$/, ''), name: entry.name, presentationId: match[1] });
        }
      };
      await visit(await readDir(root, { recursive: true }));
      return found;
    }
}
