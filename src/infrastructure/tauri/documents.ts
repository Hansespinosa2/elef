import { open } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import type { DocumentReader, DocumentSelection, FileSelector, WorldFileSystem, WorldPresentationFile } from '../../application/ports/documents';
import { readUtf8Markdown } from '../../domain/presentation/utf8';

export class TauriFileSelector implements FileSelector {
  async select(): Promise<DocumentSelection | null> {
    const selected = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    if (typeof selected !== 'string') return null;
    return {
      name: selected.split(/[\\/]/).pop() || selected,
      read: async () => (await readFile(selected)).buffer,
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
        const selected = await open({
          directory: true,
          multiple: false,
          recursive: true,
          canCreateDirectories: true,
          title: 'Choose or create your Elef World folder',
        });
        return typeof selected === 'string' ? selected : null;
      }
      async locatePresentation(): Promise<string | null> {
        const selected = await open({ directory: false, multiple: false, filters: [{ name: 'Elef presentation', extensions: ['md'] }] });
        return typeof selected === 'string' ? selected : null;
      }
      async ensureDir(path: string) { await mkdir(path, { recursive: true }); }
      async readText(path: string) { return readTextFile(path); }
      async writeText(path: string, content: string) { await writeTextFile(path, content); }
      async rename(path: string, nextPath: string) { await rename(path, nextPath); }
      async remove(path: string) { await remove(path, { recursive: true }); }
    async exists(path: string) { return exists(path); }
    async scanPresentations(root: string): Promise<WorldPresentationFile[]> {
      const found: WorldPresentationFile[] = [];
      const visit = async (directory: string, entries: Awaited<ReturnType<typeof readDir>>): Promise<void> => {
        for (const entry of entries) {
          const entryPath = `${directory.replace(/[\\/]+$/, '')}/${entry.name}`;
          if (entry.isDirectory) { await visit(entryPath, await readDir(entryPath)); continue; }
          if (entry.name !== 'presentation.md') continue;
          const text = await readTextFile(entryPath);
          const match = text.match(/<!--\s*elef-id:\s*([a-zA-Z0-9_-]+)\s*-->/);
          if (match) found.push({ path: directory, name: entry.name, presentationId: match[1] });
        }
      };
      await visit(root, await readDir(root));
      return found;
    }
}
