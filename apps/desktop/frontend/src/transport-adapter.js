export function createTransportAdapter({ invoke, onConflict = () => {} }) {
  const baseHashes = new Map()

  return {
    readWorkFolder(id) {
      return invoke("open_work_folder", { id })
    },

    activateWorkFolder(workFolder, requestedId = workFolder.id) {
      if (workFolder.id !== requestedId) baseHashes.delete(requestedId)
      baseHashes.set(workFolder.id, workFolder.content_hash)
    },

    async openWorkFolder(id) {
      const workFolder = await invoke("open_work_folder", { id })
      if (workFolder.id !== id) baseHashes.delete(id)
      baseHashes.set(workFolder.id, workFolder.content_hash)
      return workFolder
    },

    readSourceSnapshot(id) {
      return invoke("read_source_snapshot", { id })
    },

    pollFileEvents() {
      return invoke("poll_file_events", {})
    },

    takeSnapshot(id, reason, source) {
      return invoke("take_snapshot", { id, reason, source: source ?? null })
    },

    async mergeExternalChange(id, localSource) {
      const outcome = await invoke("merge_external_change", { id, localSource })
      if (outcome && typeof outcome === "object" && typeof outcome.Merged === "string") {
        return { kind: "merged", source: outcome.Merged }
      }
      if (outcome === "Overlap") return { kind: "overlap" }
      if (outcome === "Suspicious") return { kind: "suspicious" }
      throw {
        code: "invalid_response",
        message: "Elef received an unrecognized merge result.",
        retryable: false
      }
    },

    async saveSource(id, source) {
      const baseHash = baseHashes.get(id)
      if (!baseHash) {
        throw {
          code: "not_found",
          message: "Open this Work again before saving.",
          retryable: false
        }
      }

      try {
        const result = await invoke("save_source", { id, source, baseHash })
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
