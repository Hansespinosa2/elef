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

export interface WorldPresentationFile {
  path: string;
  name: string;
  presentationId: string;
}

export interface WorldFileSystem {
  selectWorld(): Promise<string | null>;
  locatePresentation(): Promise<string | null>;
  ensureDir(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  rename(path: string, nextPath: string): Promise<void>;
  scanPresentations(root: string): Promise<WorldPresentationFile[]>;
  exists(path: string): Promise<boolean>;
}
