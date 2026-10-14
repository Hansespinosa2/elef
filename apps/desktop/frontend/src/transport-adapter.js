// Desktop integration boundary: the shared application (packages/client,
// editor-runtime) never calls raw Tauri invoke() or names Rust commands.
// This adapter maps work-folder open, save, snapshot, and merge operations
// to named commands; library listing and CRUD live in
// file-library-transport.js, media URL schemes in media-transport.js,
// preview rendering in a local web worker with no Rust round trip, and the
// desktop entry point injects these services at boot. Failures cross as
// typed errors with a stable code and user-safe message, mapped to fetch
// response shapes; raw
// OS errors are never shown. Saves carry the base_hash captured at load or
// the last successful write; a mismatch returns a conflict and preserves
// the local buffer, and a successful write updates the base hash (protocol:
// ADR-008). Desktop frontend edits belong here only for native transport,
// lifecycle, window, media, close, or updater integration; anything
// host-neutral belongs in packages/client (pure semantics in work-model).
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
