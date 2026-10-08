// Tauri implementation of the shared authoring-registry transport seam the
// client AuthoringDialog consumes. Invoke stays injected (desktop test
// convention); backend error codes (conflict, invalid_input, ...) pass
// through untouched because the Rust side already speaks the dialog's
// failure language.

export function createTauriAuthoringTransport({ invoke }) {
  if (typeof invoke !== "function") throw new TypeError("A Tauri invoke function is required.")
  return {
    async readRegistries() {
      const result = await invoke("read_authoring_registries")
      return {
        snippets: result?.snippets || [],
        math_shortcuts: result?.math_shortcuts || [],
        hashes: result?.hashes || { snippets: null, math_shortcuts: null }
      }
    },
    async writeRegistry({ registry, entries, baseHash }) {
      if (registry !== "snippets" && registry !== "math_shortcuts") {
        throw Object.assign(new Error("Choose a supported authoring registry."), { code: "invalid_input" })
      }
      // The backend rejects non-sha256 base hashes as invalid input; fail
      // here with the same code instead of sending a write that cannot pass.
      if (typeof baseHash !== "string" || !/^[0-9a-f]{64}$/i.test(baseHash)) {
        throw Object.assign(new Error("Authoring settings changed outside Elef. Close and reopen settings to load the latest entries before saving."), { code: "conflict" })
      }
      const result = await invoke("write_authoring_registry", {
        registry,
        entries: [...entries],
        base_hash: baseHash
      })
      return { contentHash: result?.content_hash ?? null }
    }
  }
}
