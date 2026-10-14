// Serialize navigation so two reads cannot activate works in the wrong order.
export function createWorkOpenFlow<Id>(open: (id: Id) => unknown): (id: Id) => Promise<unknown> {
  let previous: Promise<unknown> = Promise.resolve()
  return (id: Id) => {
    const request = previous.then(() => open(id))
    previous = request.catch(() => {})
    return request
  }
}

// Reads and graph/controller preparation keep the current work's save owner
// and fingerprint intact. Edits during any await save against that owner;
// reread the target afterward so a same-work reopen cannot load stale bytes.
export interface WorkOpenDeps<Id, Work extends { id: Id }> {
  read(target: Id): Work | Promise<Work>;
  prepare(work: Work): unknown;
  isDirty(): boolean;
  flushSave(): unknown;
  getRevision?(): unknown;
}

export async function prepareWorkOpen<Id, Work extends { id: Id }>(
  id: Id,
  { read, prepare, isDirty, flushSave, getRevision = () => undefined }: WorkOpenDeps<Id, Work>
): Promise<{ work: Work; prepared: unknown; revision: unknown } | null> {
  let target = id
  while (true) {
    const revision = getRevision()
    const work = await read(target)
    const prepared = await prepare(work)
    if (isDirty()) {
      if (!(await flushSave())) return null
    } else if (getRevision() === revision) {
      return { work, prepared, revision }
    }
    // Autosave may have completed before preparation, making dirty false.
    // Its revision still invalidates the previously captured disk snapshot.
    target = work.id
  }
}
