import type { ElefError } from "./errors.js";
import type { WorkId, WorkKind, WorkspaceId } from "./ids.js";

export interface PersistenceBaseline {
  revision: string;
}

export interface WorkSummary {
  id: WorkId;
  workspaceId: WorkspaceId;
  title: string;
  kind: WorkKind;
}

export interface WorkSnapshot extends WorkSummary {
  text: string;
  baseline: PersistenceBaseline;
}

export type TextChange = { from: number; to: number; insert: string };

export type SaveResult =
  | { kind: "saved"; baseline: PersistenceBaseline }
  | { kind: "conflict"; current: WorkSnapshot };

export type FlushResult =
  | { kind: "clean" | "saved"; baseline: PersistenceBaseline }
  | { kind: "conflict"; current: WorkSnapshot }
  | { kind: "failed"; error: ElefError };

export type SessionStatus =
  | { kind: "clean" | "dirty" | "saving" }
  | { kind: "error"; error: ElefError };

export interface WorkSession {
  readonly workId: WorkId;
  readonly kind: WorkKind;
  getText(): string;
  applyLocalChange(change: TextChange): void;
  replaceText(text: string): void;
  onExternalChange(h: (snapshot: WorkSnapshot) => void): () => void;
  onStatus(h: (status: SessionStatus) => void): () => void;
  flush(): Promise<FlushResult>;
  dispose(): void;
}
