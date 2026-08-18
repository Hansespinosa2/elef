import { hasUnsavedChanges, parseMarkdown, setPresentationTheme } from '../../domain/presentation';
import type { Presentation, PresentationTheme } from '../../domain/presentation';
import type { DocumentReader, FileSelector, ReplacementConfirmation } from '../ports/documents';

export interface EditorState {
  source: string;
  sourceName: string | null;
  baseline: string;
  presentation: Presentation | null;
  error: string | null;
}

export interface EditorRecoverySnapshot {
  sourceName: string;
  source: string;
  updatedAt: number;
}

function createInitialState(): EditorState {
  return {
    source: '',
    sourceName: null,
    baseline: '',
    presentation: null,
    error: null,
  };
}

export class PresentationEditorSession {
  private state: EditorState = createInitialState();
  private listeners = new Set<() => void>();
  private request = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recovery: EditorRecoverySnapshot | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem('elef.editor.recovery');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.sourceName === 'string' && typeof parsed.source === 'string') this.recovery = parsed;
    } catch { /* recovery is best effort */ }
  }

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
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        this.recovery = { sourceName, source, updatedAt: Date.now() };
        try { localStorage.setItem('elef.editor.recovery', JSON.stringify(this.recovery)); } catch { /* best effort */ }
      }, 1000);
    } catch (reason) {
      this.setState({
        ...this.state,
        source,
        error: reason instanceof Error ? reason.message : 'Unable to parse this Markdown source.',
      });
    }

  }

  recoverySnapshot(): EditorRecoverySnapshot | null {
    return this.recovery;
  }

  restoreRecovery(confirm: ReplacementConfirmation): boolean {
    if (!this.recovery || !this.canReplace(confirm)) return false;
    this.setState({
      source: this.recovery.source,
      sourceName: this.recovery.sourceName,
      baseline: '',
      presentation: parseMarkdown(this.recovery.source, this.recovery.sourceName),
      error: null,
    });
    return true;
  }

  discardRecovery(): void {
    this.recovery = null;
    try { localStorage.removeItem('elef.editor.recovery'); } catch { /* best effort */ }
  }

  updatePresentationTheme(theme: PresentationTheme): void {
    if (!this.state.sourceName) return;
    this.updateSource(setPresentationTheme(this.state.source, theme));
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
