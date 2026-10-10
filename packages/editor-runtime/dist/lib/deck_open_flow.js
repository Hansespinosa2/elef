function createDeckOpenFlow(open) {
  let previous = Promise.resolve();
  return (id) => {
    const request = previous.then(() => open(id));
    previous = request.catch(() => {
    });
    return request;
  };
}
async function prepareDeckOpen(id, { read, prepare, isDirty, flushSave, getRevision = () => void 0 }) {
  let target = id;
  while (true) {
    const revision = getRevision();
    const deck = await read(target);
    const prepared = await prepare(deck);
    if (isDirty()) {
      if (!await flushSave()) return null;
    } else if (getRevision() === revision) {
      return { deck, prepared, revision };
    }
    target = deck.id;
  }
}
export {
  createDeckOpenFlow,
  prepareDeckOpen
};
