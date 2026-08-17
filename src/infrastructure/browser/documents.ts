import type { DocumentReader, DocumentSelection, FileSelector, ReplacementConfirmation } from '../../application/ports/documents';

export class BrowserDocumentReader implements DocumentReader {
  async read(selection: DocumentSelection): Promise<string> {
    try {
      const bytes = await selection.read();
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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
        const file = this.input.files?.[0];
        this.input.value = '';
        resolve(file ? { name: file.name, read: () => file.arrayBuffer() } : null);
      };
      this.input.addEventListener('change', onChange, { once: true });
      this.input.click();
    });
  }
}

export class BrowserReplacementConfirmation implements ReplacementConfirmation {
  confirm(message: string): boolean {
    return window.confirm(message);
  }
}
