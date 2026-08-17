import { hasUnsavedChanges, parseMarkdown } from '../../domain/presentation';
import type { Presentation } from '../../domain/presentation';
import type { DocumentReader, FileSelector, ReplacementConfirmation } from '../ports/documents';

export interface EditorState {
  source: string;
  sourceName: string | null;
  baseline: string;
  presentation: Presentation | null;
  error: string | null;
}

const initialState: EditorState = {
  source: '',
  sourceName: null,
  baseline: '',
  presentation: null,
  error: null,
};

export class PresentationEditorSession {
  private state: EditorState = initialState;
  private listeners = new Set<() => void>();
  private request = 0;

  getState(): EditorState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: EditorState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private canReplace(confirm: ReplacementConfirmation): boolean {
    return !hasUnsavedChanges(this.state.source, this.state.baseline, this.state.sourceName)
      || confirm.confirm('You have unsaved changes. Replace them with a new Markdown document?');
  }

  newDocument(confirm: ReplacementConfirmation): void {
    if (!this.canReplace(confirm)) return;
    this.request += 1;
    const sourceName = 'Untitled presentation';
    this.setState({
      source: '',
      sourceName,
      baseline: '',
      presentation: parseMarkdown('', sourceName),
      error: null,
    });
  }

  updateSource(source: string): void {
    const sourceName = this.state.sourceName || 'Untitled presentation';
    try {
      this.setState({ ...this.state, source, presentation: parseMarkdown(source, sourceName), error: null });
    } catch (reason) {
      this.setState({
        ...this.state,
        source,
        error: reason instanceof Error ? reason.message : 'Unable to parse this Markdown source.',
      });
    }
  }

  async open(
    selector: FileSelector,
    reader: DocumentReader,
    confirm: ReplacementConfirmation,
  ): Promise<void> {
    if (!this.canReplace(confirm)) return;
    const request = ++this.request;
    try {
      const selection = await selector.select();
      if (!selection || request !== this.request) return;
      if (!this.canReplace(confirm)) return;
      const text = await reader.read(selection);
      if (request !== this.request) return;
      const presentation = parseMarkdown(text, selection.name);
      this.setState({ source: text, sourceName: selection.name, baseline: text, presentation, error: null });
    } catch (reason) {
      if (request !== this.request) return;
      this.setState({
        ...this.state,
        error: reason instanceof Error && reason.message
          ? reason.message
          : 'Could not read the selected file. Select a UTF-8 Markdown file and try again.',
      });
    }
  }
}
