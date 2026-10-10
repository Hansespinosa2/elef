import { invoke } from "@tauri-apps/api/core"
import builtInRegistry from "../../../../apps/web/app/javascript/data/default_authoring_registry.json"
import { applyAuthoringRegistryToEditor, mergeAuthoringRegistryEntries } from "@elef/editor-runtime"

let currentRegistry = builtInRegistry

function apply(entries) {
  currentRegistry = entries
  applyAuthoringRegistryToEditor(entries)
}

export function desktopAuthoringRegistry() {
  return currentRegistry
}

export async function loadDesktopAuthoringRegistry() {
  let custom = { snippets: [], math_shortcuts: [] }
  try {
    custom = await invoke("read_authoring_registries")
  } catch (_error) {
    // The editor can start before a library is selected; built-ins still work.
  }
  const registry = mergeAuthoringRegistryEntries(
    builtInRegistry,
    custom.snippets || [],
    custom.math_shortcuts || []
  )
  apply(registry)
  return registry
}

try {
  const status = await invoke("get_library_status")
  if (status) await loadDesktopAuthoringRegistry()
  else apply(builtInRegistry)
} catch (_error) {
  apply(builtInRegistry)
}
