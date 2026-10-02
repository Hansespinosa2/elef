function registryKey(entry) {
  return JSON.stringify([entry.namespace || "", String(entry.id)])
}

export function mergeAuthoringRegistryEntries(builtInEntries, snippetEntries = [], mathShortcutEntries = []) {
  const entries = new Map()
  for (const entry of builtInEntries) {
    if (entry && (typeof entry.id === "string" || typeof entry.id === "number")) {
      entries.set(registryKey(entry), entry)
    }
  }
  for (const entry of [...snippetEntries, ...mathShortcutEntries]) {
    if (!entry || entry.built_in === true || (typeof entry.id !== "string" && typeof entry.id !== "number")) continue
    entries.set(registryKey(entry), entry)
  }
  return [...entries.values()]
}
