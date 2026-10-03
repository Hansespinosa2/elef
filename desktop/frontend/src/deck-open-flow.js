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
export async function prepareDeckOpen(id, { read, prepare, isDirty, flushSave }) {
  let deck = await read(id)
  let prepared = await prepare(deck)
  while (isDirty()) {
    if (!(await flushSave())) return null
    deck = await read(deck.id)
    prepared = await prepare(deck)
  }
  return { deck, prepared }
}
