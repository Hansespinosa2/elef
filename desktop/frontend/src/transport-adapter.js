export function createTransportAdapter({ invoke, onConflict = () => {} }) {
  const baseHashes = new Map()

  return {
    async openDeck(id) {
      const deck = await invoke("open_deck", { id })
      baseHashes.set(id, deck.content_hash)
      return deck
    },

    readSourceSnapshot(id) {
      return invoke("read_source_snapshot", { id })
    },

    async saveSource(id, source) {
      const baseHash = baseHashes.get(id)
      if (!baseHash) {
        throw {
          code: "not_found",
          message: "Open this deck again before saving.",
          retryable: false
        }
      }

      try {
        const result = await invoke("save_source", { id, source, base_hash: baseHash })
        baseHashes.set(id, result.content_hash)
        return result
      } catch (error) {
        if (error?.code === "conflict") {
          onConflict({ id, source, details: error.details || {} })
        }
        throw error
      }
    },

    acceptDiskVersion(id, contentHash) {
      if (typeof contentHash !== "string" || !/^[a-f\d]{64}$/i.test(contentHash)) {
        throw new TypeError("A valid disk content hash is required.")
      }
      baseHashes.set(id, contentHash)
    }
  }
}
