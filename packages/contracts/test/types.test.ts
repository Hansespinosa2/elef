import type {
  ElefError,
  ElefHost,
  FlushResult,
  HostCapabilities,
  MediaId,
  PersistenceBaseline,
  RequestId,
  SaveResult,
  SessionStatus,
  WorkId,
  WorkKind,
  WorkSession,
  WorkSnapshot,
  WorkspaceId,
} from "../src/index.js";

// Brands are nominal: plain strings are not assignable.
const workspaceId = "ws-1" as WorkspaceId;
const workId = "work-1" as WorkId;
const mediaId = "media-1" as MediaId;
const requestId = "req-1" as RequestId;

// @ts-expect-error plain string is not a WorkspaceId
const badWorkspace: WorkspaceId = "ws-1";
// @ts-expect-error brands do not cross-assign
const badWork: WorkId = workspaceId;
void badWorkspace;
void badWork;
void mediaId;
void requestId;

const kind: WorkKind = "document";
// @ts-expect-error only document | presentation
const badKind: WorkKind = "spreadsheet";
void badKind;

const capabilities: HostCapabilities = {
  accounts: false,
  collaboration: false,
  entitlements: false,
  updater: true,
  nativeMenus: true,
  localFilesystem: true,
};

const baseline: PersistenceBaseline = { revision: "abc123" };

const saved: SaveResult = { kind: "saved", baseline };
const conflict: SaveResult = {
  kind: "conflict",
  current: { id: workId, workspaceId, title: "t", kind, text: "hi", baseline },
};
// @ts-expect-error SaveResult requires a baseline on saved
const badSave: SaveResult = { kind: "saved" };
void badSave;

const flushed: FlushResult = { kind: "clean", baseline };
const failed: FlushResult = {
  kind: "failed",
  error: { category: "storage_unavailable", message: "disk gone", retryable: true } satisfies ElefError,
};
void flushed;
void failed;

const status: SessionStatus = { kind: "dirty" };
// @ts-expect-error error status requires an error payload
const badStatus: SessionStatus = { kind: "error" };
void status;
void badStatus;

async function useSession(session: WorkSession, snapshot: WorkSnapshot): Promise<void> {
  const id: WorkId = session.workId;
  const sessionKind: WorkKind = session.kind;
  void id;
  void sessionKind;
  session.applyLocalChange({ from: 0, to: 1, insert: "x" });
  session.replaceText(snapshot.text);
  const offExternal = session.onExternalChange((next) => {
    const text: string = next.text;
    void text;
  });
  const offStatus = session.onStatus((next) => {
    if (next.kind === "error") {
      const category = next.error.category;
      void category;
    }
  });
  const result = await session.flush();
  if (result.kind === "conflict") {
    session.replaceText(result.current.text);
  }
  offExternal();
  offStatus();
  session.dispose();
}
void useSession;

async function useHost(host: ElefHost): Promise<void> {
  const caps: HostCapabilities = host.capabilities;
  void caps;
  const session = await host.createWorkSession(workId);
  session.dispose();
  const hits = await host.search.search({ requestId, query: "q", workspaceId });
  if (hits.requestId !== requestId) {
    throw new Error("request id echo required");
  }
  const bytes = await host.transfer.exportElef([workId]);
  void bytes;
}
void useHost;
