// Tauri implementation of the shared authoring-registry transport seam the
// client AuthoringDialog consumes. Invoke stays injected (desktop test
// convention); backend error codes (conflict, invalid_input, ...) pass
// through untouched because the Rust side already speaks the dialog's
// failure language. Reads merge the backend custom entries over the same
// built-in catalog the editor palettes use, exactly like the server does
// for the web transport, so built-ins render read-only on both hosts.

export function createTauriAuthoringTransport({ invoke, builtInEntries = [], mergeEntries }) {
  if (typeof invoke !== "function") throw new TypeError("A Tauri invoke function is required.")
  if (typeof mergeEntries !== "function") throw new TypeError("A registry merge function is required.")
  return {
    async readRegistries() {
      const result = await invoke("read_authoring_registries")
      const merged = mergeEntries(
        builtInEntries,
        result?.snippets || [],
        result?.math_shortcuts || []
      )
      return {
        snippets: merged.filter(entry => typeof entry.body === "string" && typeof entry.trigger === "string"),
        math_shortcuts: merged.filter(entry => typeof entry.expansion === "string" && Array.isArray(entry.aliases)),
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
