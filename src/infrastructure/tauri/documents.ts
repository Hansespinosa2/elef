import { open } from '@tauri-apps/api/dialog';
import { readBinaryFile } from '@tauri-apps/api/fs';
import type { DocumentReader, DocumentSelection, FileSelector } from '../../application/ports/documents';

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
    return new TextDecoder('utf-8', { fatal: true }).decode(await selection.read());
  }
}
