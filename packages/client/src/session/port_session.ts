// Minimal WorkSession over a host WorksPort: the single implementation of
// ElefHost.createWorkSession shared by both host adapters (previously
// duplicated line-for-line in each host).
//
// The session holds its text in memory, reports dirty/saving/clean status,
// and flushes through getWork/saveWork with optimistic-concurrency
// conflicts surfaced to external-change subscribers. Editor-bound
// persistence (autosave timing, drafts, recovery) belongs to
// createWorkSession in work_session.ts, not here.
import type {
  FlushResult,
  SessionStatus,
  TextChange,
  WorkId,
  WorkSession,
  WorkSnapshot,
  WorksPort,
} from "@elef/contracts"

export async function createPortSession(
  ports: Pick<WorksPort, "getWork" | "saveWork">,
  workId: WorkId
): Promise<WorkSession> {
  const snapshot = await ports.getWork(workId)
  let text = snapshot.text
  let revision = snapshot.baseline.revision
  let disposed = false
  const statusHandlers = new Set<(status: SessionStatus) => void>()
  const externalHandlers = new Set<(snapshot: WorkSnapshot) => void>()

  function emitStatus(status: SessionStatus): void {
    for (const handler of statusHandlers) handler(status)
  }

  const session: WorkSession = {
    workId,
    kind: snapshot.kind,
    getText() {
      return text
    },
    applyLocalChange(change: TextChange) {
      text = text.slice(0, change.from) + change.insert + text.slice(change.to)
      emitStatus({ kind: "dirty" })
    },
    replaceText(next: string) {
      text = next
      emitStatus({ kind: "dirty" })
    },
    onExternalChange(handler: (snapshot: WorkSnapshot) => void) {
      externalHandlers.add(handler)
      return () => {
        externalHandlers.delete(handler)
      }
    },
    onStatus(handler: (status: SessionStatus) => void) {
      statusHandlers.add(handler)
      return () => {
        statusHandlers.delete(handler)
      }
    },
    async flush(): Promise<FlushResult> {
      if (disposed) {
        return {
          kind: "failed",
          error: { category: "invalid_input", message: "session disposed", retryable: false }
        }
      }
      const live = await ports.getWork(workId)
      if (live.text === text && live.baseline.revision === revision) {
        return { kind: "clean", baseline: live.baseline }
      }
      emitStatus({ kind: "saving" })
      const result = await ports.saveWork(workId, text, { revision })
      if (result.kind === "saved") {
        revision = result.baseline.revision
        emitStatus({ kind: "clean" })
        return result
      }
      for (const handler of externalHandlers) handler(result.current)
      emitStatus({ kind: "clean" })
      return result
    },
    dispose() {
      disposed = true
    }
  }
  return session
}
