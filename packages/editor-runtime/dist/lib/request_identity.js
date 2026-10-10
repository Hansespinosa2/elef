function createRequestGuard() {
  let generation = 0;
  function request() {
    generation += 1;
    return generation;
  }
  function isCurrent(token) {
    return token === generation;
  }
  function invalidate() {
    generation += 1;
  }
  return Object.freeze({ request, isCurrent, invalidate });
}
export {
  createRequestGuard
};
