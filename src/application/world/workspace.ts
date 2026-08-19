import {
  extractFirstH1,
  normalizeFolderName,
  parseMarkdown,
  setPresentationTheme,
  upsertFirstH1,
} from '../../domain/presentation';
import type { PresentationTheme } from '../../domain/presentation';
import type { WorldFileSystem } from '../ports/documents';

export interface WorldPresentation {
  id: string;
  path: string;
  title: string;
  source: string;
  lastOpened: number;
  missing?: boolean;
  error?: string;
}

export interface WorldState {
  root: string | null;
  presentations: WorldPresentation[];
  activeId: string | null;
  error: string | null;
}

export interface RecoverySnapshot {
  presentationId: string;
  source: string;
  updatedAt: number;
}

const key = 'elef.world';
const recoveryKey = 'elef.world.recovery';
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`;
const presentationFile = (path: string) => join(path, 'presentation.md');
const metadataPattern = /^\s*<!--\s*elef-id:\s*[a-zA-Z0-9_-]+\s*-->\s*\n?/;

export function stripWorldMetadata(source: string): string {
  return source.replace(metadataPattern, '');
}

function addWorldMetadata(source: string, presentationId: string): string {
  return `<!-- elef-id: ${presentationId} -->\n${stripWorldMetadata(source)}`;
}

export class WorldWorkspace {
  private state: WorldState = { root: null, presentations: [], activeId: null, error: null };
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private recoveries = new Map<string, RecoverySnapshot>();
  private storage: Storage | null;

  constructor(private readonly fs: WorldFileSystem, storage?: Storage | null) {
    this.storage = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage;
    let saved: string | null = null;
    try { saved = this.storage?.getItem(key) || null; } catch { saved = null; }
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.state = {
          ...this.state,
          root: typeof parsed.root === 'string' ? parsed.root : null,
          presentations: Array.isArray(parsed.presentations) ? parsed.presentations : [],
        };
      } catch { /* recover on setup */ }
    }
    try {
      const savedRecovery = this.storage?.getItem(recoveryKey);
      const parsedRecovery = savedRecovery ? JSON.parse(savedRecovery) : {};
      if (parsedRecovery && typeof parsedRecovery === 'object') {
        for (const [presentationId, snapshot] of Object.entries(parsedRecovery)) {
          if (snapshot && typeof snapshot === 'object' && typeof (snapshot as RecoverySnapshot).source === 'string') {
            this.recoveries.set(presentationId, {
              presentationId,
              source: (snapshot as RecoverySnapshot).source,
              updatedAt: typeof (snapshot as RecoverySnapshot).updatedAt === 'number'
                ? (snapshot as RecoverySnapshot).updatedAt
                : Date.now(),
            });
          }
        }
      }
    } catch { /* recovery is best effort */ }
  }
  getState(): WorldState { return this.state; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private setState(state: WorldState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  private persist() {
    if (this.storage && this.state.root) {
      try { this.storage.setItem(key, JSON.stringify({ root: this.state.root, presentations: this.state.presentations })); } catch { /* persistence is best effort */ }
    }
  }
  private persistRecoveries() {
    if (!this.storage) return;
    try {
      this.storage.setItem(recoveryKey, JSON.stringify(Object.fromEntries(this.recoveries)));
    } catch { /* recovery is best effort */ }
  }
  private retainRecovery(idToRecover: string, source: string) {
    const snapshot = { presentationId: idToRecover, source, updatedAt: Date.now() };
    this.recoveries.set(idToRecover, snapshot);
    this.persistRecoveries();
  }
  recoverySnapshot(idToRead: string): RecoverySnapshot | null {
    return this.recoveries.get(idToRead) || null;
  }
  discardRecovery(idToDiscard: string): void {
    this.recoveries.delete(idToDiscard);
    this.persistRecoveries();
  }
  restoreRecovery(idToRestore: string): boolean {
    const snapshot = this.recoverySnapshot(idToRestore);
    if (!snapshot) return false;
    this.updateSource(idToRestore, snapshot.source);
    return true;
  }
  async setup(): Promise<boolean> {
    try {
      const root = await this.fs.selectWorld();
      if (!root) return false;
      this.setState({ ...this.state, root, presentations: [], activeId: null, error: null });
      this.persist();
      await this.rescan();
      return true;
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not select the Elef World.' });
      return false;
    }
  }
  async rescan(): Promise<void> {
    if (!this.state.root) return;
    try {
      const found = await this.fs.scanPresentations(this.state.root);
      const byId = new Map(found.map((item) => [item.presentationId, item]));
      const entries = await Promise.all(this.state.presentations.map(async (entry) => {
        const match = byId.get(entry.id);
        if (!match) return { ...entry, missing: true };
        const source = await this.fs.readText(presentationFile(match.path)).catch(() => entry.source);
        return { ...entry, path: match.path, source, title: extractFirstH1(source) || entry.title, missing: false };
      }));
      const knownIds = new Set(entries.map((entry) => entry.id));
      const discovered = await Promise.all(found
        .filter((item) => item.presentationId && !knownIds.has(item.presentationId))
        .map(async (item) => {
          const source = await this.fs.readText(presentationFile(item.path));
          return {
            id: item.presentationId,
            path: item.path,
            title: extractFirstH1(source) || item.path.split(/[\\/]/).pop() || 'Untitled presentation',
            source,
            lastOpened: 0,
          };
        }));
      this.setState({ ...this.state, presentations: [...entries, ...discovered], error: null });
      this.persist();
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not scan the Elef World.' });
    }
  }
  async createDraft(): Promise<WorldPresentation | null> {
    if (!this.state.root) return null;
    const presentationId = id();
    const folder = `Untitled presentation ${presentationId.slice(-6)}`;
    const path = join(this.state.root, folder);
    try {
      await this.fs.ensureDir(path);
      const initialSource = ':::slide-layout{intro}\n# ';
      await this.fs.writeText(join(path, 'presentation.md'), addWorldMetadata(initialSource, presentationId));
      const entry = { id: presentationId, path, title: 'Untitled presentation', source: addWorldMetadata(initialSource, presentationId), lastOpened: Date.now() };
      this.setState({ ...this.state, presentations: [entry, ...this.state.presentations], activeId: presentationId, error: null });
      this.persist();
      return entry;
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not create the presentation.' });
      return null;
    }
  }
  async renamePresentation(idToRename: string, title: string): Promise<void> {
    const entry = this.state.presentations.find((item) => item.id === idToRename);
    if (!entry) return;
    const nextTitle = normalizeFolderName(title);
    if (!nextTitle) return;
    const source = stripWorldMetadata(entry.source);
    const renamedSource = upsertFirstH1(source, nextTitle);
    this.updateSource(idToRename, renamedSource);
    const timer = this.timers.get(idToRename);
    if (timer) clearTimeout(timer);
    this.timers.delete(idToRename);
    await this.save(idToRename);
  }
  async deletePresentation(idToDelete: string): Promise<void> {
    const entry = this.state.presentations.find((item) => item.id === idToDelete);
    if (!entry) return;
    try {
      await this.fs.remove(entry.path);
      const timer = this.timers.get(idToDelete);
      if (timer) clearTimeout(timer);
      this.timers.delete(idToDelete);
      const recoveryTimer = this.recoveryTimers.get(idToDelete);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      this.recoveryTimers.delete(idToDelete);
      this.discardRecovery(idToDelete);
      this.setState({
        ...this.state,
        presentations: this.state.presentations.filter((item) => item.id !== idToDelete),
        activeId: this.state.activeId === idToDelete ? null : this.state.activeId,
        error: null,
      });
      this.persist();
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not delete the presentation.' });
    }
  }
  open(idToOpen: string) {
    const entry = this.state.presentations.find((item) => item.id === idToOpen);
    if (!entry) return;
    this.setState({ ...this.state, activeId: idToOpen, presentations: this.state.presentations.map((item) => item.id === idToOpen ? { ...item, lastOpened: Date.now() } : item) });
    this.persist();
  }
  close() {
    if (this.state.activeId) {
      const timer = this.timers.get(this.state.activeId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(this.state.activeId);
      }
      void this.save(this.state.activeId);
    }
    this.setState({ ...this.state, activeId: null });
  }
  removeMissing(idToRemove: string) {
    this.setState({ ...this.state, presentations: this.state.presentations.filter((item) => item.id !== idToRemove) });
    this.persist();
  }
  async locate(idToLocate: string): Promise<void> {
    const selected = await this.fs.locatePresentation();
    if (!selected) return;
    try {
      const source = await this.fs.readText(selected);
      const locatedId = source.match(/<!--\s*elef-id:\s*([a-zA-Z0-9_-]+)\s*-->/)?.[1];
      if (locatedId !== idToLocate) throw new Error('The selected file is not the missing Elef presentation.');
      const folder = selected.replace(/[\\/]+presentation\.md$/, '');
      this.setState({
        ...this.state,
        presentations: this.state.presentations.map((item) => item.id === idToLocate
          ? { ...item, path: folder, source, title: extractFirstH1(source) || item.title, missing: false, error: undefined }
          : item),
        error: null,
      });
      this.persist();
      this.open(idToLocate);
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not locate the presentation.' });
    }
  }
  updateSource(idToUpdate: string, source: string) {
    const entry = this.state.presentations.find((item) => item.id === idToUpdate);
    if (!entry) return;
    const persistedSource = addWorldMetadata(source, idToUpdate);
    const oldRecoveryTimer = this.recoveryTimers.get(idToUpdate);
    if (oldRecoveryTimer) clearTimeout(oldRecoveryTimer);
    this.recoveryTimers.set(idToUpdate, setTimeout(() => {
      this.recoveryTimers.delete(idToUpdate);
      this.retainRecovery(idToUpdate, source);
    }, 1000));
    let parsedTitle = entry.title;
    try {
      parsedTitle = extractFirstH1(stripWorldMetadata(source)) || entry.title;
      parseMarkdown(stripWorldMetadata(source), parsedTitle);
    } catch (reason) {
      const message = reason instanceof Error && reason.message ? reason.message : 'Unable to parse this Markdown source.';
      this.setState({
        ...this.state,
        presentations: this.state.presentations.map((item) => item.id === idToUpdate
          ? { ...item, source: persistedSource, error: message, missing: false }
          : item),
        error: message,
      });
      this.persist();
      return;
    }
    if (import.meta.env.DEV) console.debug('[elef] source mutation', { action: 'updateSource', phase: 'parsed', presentationId: idToUpdate });
    this.setState({ ...this.state, presentations: this.state.presentations.map((item) => item.id === idToUpdate ? { ...item, source: persistedSource, title: parsedTitle, missing: false, error: undefined } : item), error: null });
    this.persist();
    const oldTimer = this.timers.get(idToUpdate); if (oldTimer) clearTimeout(oldTimer);
    this.timers.set(idToUpdate, setTimeout(() => {
      this.timers.delete(idToUpdate);
      void this.save(idToUpdate);
    }, 350));
  }
  updatePresentationTheme(idToUpdate: string, theme: PresentationTheme) {
    const source = this.editorSource(idToUpdate);
    if (!this.state.presentations.some((item) => item.id === idToUpdate)) return;
    this.updateSource(idToUpdate, setPresentationTheme(source, theme));
  }
  private async save(idToSave: string) {
    const entry = this.state.presentations.find((item) => item.id === idToSave);
    if (!entry || entry.missing) return;
    try {
      const editorSource = stripWorldMetadata(entry.source);
      const nextTitle = normalizeFolderName(extractFirstH1(editorSource), entry.title);
      const currentName = entry.path.split(/[\\/]/).pop() || '';
      let path = entry.path;
      if (nextTitle !== currentName) {
        let suffix = 1;
        let nextPath = join(this.state.root!, nextTitle);
        while (await this.fs.exists(nextPath)) nextPath = join(this.state.root!, `${nextTitle} ${++suffix}`);
        await this.fs.rename(entry.path, nextPath);
        path = nextPath;
      }
      await this.fs.writeText(join(path, 'presentation.md'), addWorldMetadata(editorSource, idToSave));
      this.setState({ ...this.state, presentations: this.state.presentations.map((item) => item.id === idToSave ? { ...item, path, title: extractFirstH1(editorSource) || item.title, error: undefined } : item), error: null });
      this.persist();
    } catch (reason) {
      this.setState({ ...this.state, error: reason instanceof Error ? reason.message : 'Could not save the presentation.' });
      if (!this.timers.has(idToSave)) {
        this.timers.set(idToSave, setTimeout(() => {
          this.timers.delete(idToSave);
          void this.save(idToSave);
        }, 1000));
      }
    }
  }
  editorSource(idToRead: string) { const entry = this.state.presentations.find((item) => item.id === idToRead); return entry ? stripWorldMetadata(entry.source) : ''; }
  presentation(idToRead: string) {
    const entry = this.state.presentations.find((item) => item.id === idToRead);
    if (!entry) return null;
    try {
      return parseMarkdown(stripWorldMetadata(entry.source), entry.title);
    } catch {
      return null;
    }
  }
}
