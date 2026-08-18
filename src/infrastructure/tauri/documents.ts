import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import type { DocumentReader, DocumentSelection, FileSelector } from '../../application/ports/documents';
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
