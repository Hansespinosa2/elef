import type { MediaId, RequestId, WorkId, WorkspaceId, WorkKind } from "./ids.js";
import type {
  PersistenceBaseline,
  SaveResult,
  WorkSession,
  WorkSnapshot,
  WorkSummary,
} from "./session.js";

export interface LibraryPort {
  listWorkspaces(): Promise<{ id: WorkspaceId; name: string }[]>;
  listWorks(workspaceId: WorkspaceId): Promise<WorkSummary[]>;
  createWork(input: {
    workspaceId: WorkspaceId;
    title: string;
    kind: WorkKind;
    text?: string;
  }): Promise<WorkSummary>;
  renameWork(workId: WorkId, title: string): Promise<WorkSummary>;
  deleteWork(workId: WorkId): Promise<void>;
}

export interface WorksPort {
  getWork(workId: WorkId): Promise<WorkSnapshot>;
  saveWork(
    workId: WorkId,
    text: string,
    baseline: PersistenceBaseline,
  ): Promise<SaveResult>;
}

export interface MediaPort {
  listMedia(workId: WorkId): Promise<{ id: MediaId; workId: WorkId; name: string; mimeType: string }[]>;
  addMedia(
    workId: WorkId,
    input: { name: string; mimeType: string; bytes: Uint8Array },
  ): Promise<{ id: MediaId; workId: WorkId; name: string; mimeType: string }>;
  removeMedia(mediaId: MediaId): Promise<void>;
  resolveMedia(mediaId: MediaId): Promise<{ id: MediaId; workId: WorkId; name: string; mimeType: string; url: string }>;
}

export type ProductSettings = Record<string, unknown>;

export interface SettingsPort {
  getSettings(): Promise<ProductSettings>;
  updateSettings(patch: Partial<ProductSettings>): Promise<ProductSettings>;
}

export interface SearchPort {
  search(input: {
    requestId: RequestId;
    query: string;
    workspaceId?: WorkspaceId;
  }): Promise<{ requestId: RequestId; hits: { work: WorkSummary; excerpt?: string }[] }>;
}

export interface TransferPort {
  importElef(bytes: Uint8Array, workspaceId: WorkspaceId): Promise<WorkSummary[]>;
  exportElef(workIds: WorkId[]): Promise<Uint8Array>;
}

export type { WorkSession, WorkSnapshot, WorkSummary };
