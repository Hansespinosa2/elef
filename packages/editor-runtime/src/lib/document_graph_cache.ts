export function createDocumentGraphCache<Graph>(loadGraph: () => Graph | Promise<Graph>) {
  let generation = 0
  let cachedGraph: Graph | null = null
  let inFlight: { generation: number; promise: Promise<Graph> } | null = null

  async function get(): Promise<Graph> {
    while (true) {
      if (cachedGraph) return cachedGraph

      const requestGeneration = generation
      let request = inFlight
      if (!request || request.generation !== requestGeneration) {
        request = {
          generation: requestGeneration,
          promise: Promise.resolve().then(loadGraph)
        }
        inFlight = request
      }

      try {
        const graph = await request.promise
        if (requestGeneration !== generation) continue
        cachedGraph = graph
        return graph
      } catch (error) {
        if (requestGeneration !== generation) continue
        throw error
      } finally {
        if (inFlight === request) inFlight = null
      }
    }
  }

  function invalidate() {
    generation += 1
    cachedGraph = null
  }

  return Object.freeze({ get, invalidate })
}
