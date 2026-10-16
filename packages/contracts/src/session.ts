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
  // ISO-8601 last-modified timestamp for library card metadata. Optional in
  // the type for backward compatibility; every adapter populates it and the
  // conformance suite asserts its presence.
  updatedAt?: string;
  // Non-blocking library notices for the card (name/path notices). Optional
  // in the type; every adapter populates it (possibly empty) and the
  // conformance suite asserts its presence.
  warnings?: readonly string[];
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
