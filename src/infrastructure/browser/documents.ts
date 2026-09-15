import type { DocumentReader, DocumentSelection, FileSelector, ReplacementConfirmation } from '../../application/ports/documents';
import { readUtf8Markdown } from '../../domain/presentation/utf8';

export class BrowserDocumentReader implements DocumentReader {
  async read(selection: DocumentSelection): Promise<string> {
    try {
      return await readUtf8Markdown(selection.read);
    } catch {
      throw new Error(`Could not read “${selection.name}”. Select a UTF-8 Markdown file and try again.`);
    }
  }
}

export class BrowserFileSelector implements FileSelector {
  constructor(private readonly input: HTMLInputElement) {}

  select(): Promise<DocumentSelection | null> {
    return new Promise((resolve) => {
      const onChange = () => {
        this.input.removeEventListener('change', onChange);
        this.input.removeEventListener('cancel', onCancel);
        const file = this.input.files?.[0];
        this.input.value = '';
        resolve(file ? { name: file.name, read: () => file.arrayBuffer() } : null);
      };
      const onCancel = () => {
        this.input.removeEventListener('change', onChange);
        this.input.removeEventListener('cancel', onCancel);
        this.input.value = '';
        resolve(null);
      };
      this.input.addEventListener('change', onChange, { once: true });
      this.input.addEventListener('cancel', onCancel, { once: true });
      this.input.click();
    });
  }
}

export class BrowserReplacementConfirmation implements ReplacementConfirmation {
  confirm(message: string): boolean {
    return window.confirm(message);
  }
}
