// Serialize navigation so two reads cannot activate decks in the wrong order.
export function createDeckOpenFlow(open) {
  let previous = Promise.resolve()
  return id => {
    const request = previous.then(() => open(id))
    previous = request.catch(() => {})
    return request
  }
}
