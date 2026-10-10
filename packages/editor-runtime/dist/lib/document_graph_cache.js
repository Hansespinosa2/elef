function createDocumentGraphCache(loadGraph) {
  let generation = 0;
  let cachedGraph = null;
  let inFlight = null;
  async function get() {
    while (true) {
      if (cachedGraph) return cachedGraph;
      const requestGeneration = generation;
      let request = inFlight;
      if (!request || request.generation !== requestGeneration) {
        request = {
          generation: requestGeneration,
          promise: Promise.resolve().then(loadGraph)
        };
        inFlight = request;
      }
      try {
        const graph = await request.promise;
        if (requestGeneration !== generation) continue;
        cachedGraph = graph;
        return graph;
      } catch (error) {
        if (requestGeneration !== generation) continue;
        throw error;
      } finally {
        if (inFlight === request) inFlight = null;
      }
    }
  }
  function invalidate() {
    generation += 1;
    cachedGraph = null;
  }
  return Object.freeze({ get, invalidate });
}
export {
  createDocumentGraphCache
};
