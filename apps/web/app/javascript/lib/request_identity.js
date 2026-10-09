// Request-identity guard for async host flows (P06-05): a slow payload
// resolving after navigation or after a newer request started must not be
// applied. Mirrors the sequence-guard pattern in the command palette and
// the generation guard in the document graph cache.

export function createRequestGuard() {
  let generation = 0

  function request() {
    generation += 1
    return generation
  }

  function isCurrent(token) {
    return token === generation
  }

  function invalidate() {
    generation += 1
  }

  return Object.freeze({ request, isCurrent, invalidate })
}
