// Serialize navigation so two reads cannot activate decks in the wrong order.
export function createDeckOpenFlow(open) {
  let previous = Promise.resolve()
  return id => {
    const request = previous.then(() => open(id))
    previous = request.catch(() => {})
    return request
  }
}

// Reads and graph/controller preparation keep the current deck's save owner
// and fingerprint intact. Edits during any await save against that owner;
// reread the target afterward so a same-deck reopen cannot load stale bytes.
export async function prepareDeckOpen(id, { read, prepare, isDirty, flushSave, getRevision = () => undefined }) {
  let target = id
  while (true) {
    const revision = getRevision()
    const deck = await read(target)
    const prepared = await prepare(deck)
    if (isDirty()) {
      if (!(await flushSave())) return null
    } else if (getRevision() === revision) {
      return { deck, prepared, revision }
    }
    // Autosave may have completed before preparation, making dirty false.
    // Its revision still invalidates the previously captured disk snapshot.
    target = deck.id
  }
}
