function createWorkOpenFlow(open) {
  let previous = Promise.resolve();
  return (id) => {
    const request = previous.then(() => open(id));
    previous = request.catch(() => {
    });
    return request;
  };
}
async function prepareWorkOpen(id, { read, prepare, isDirty, flushSave, getRevision = () => void 0 }) {
  let target = id;
  while (true) {
    const revision = getRevision();
    const work = await read(target);
    const prepared = await prepare(work);
    if (isDirty()) {
      if (!await flushSave()) return null;
    } else if (getRevision() === revision) {
      return { work, prepared, revision };
    }
    target = work.id;
  }
}
export {
  createWorkOpenFlow,
  prepareWorkOpen
};
