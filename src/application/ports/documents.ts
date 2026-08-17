export interface DocumentSelection {
  name: string;
  read(): Promise<ArrayBuffer>;
}

export interface DocumentReader {
  read(selection: DocumentSelection): Promise<string>;
}

export interface FileSelector {
  select(): Promise<DocumentSelection | null>;
}

export interface ReplacementConfirmation {
  confirm(message: string): boolean;
}
