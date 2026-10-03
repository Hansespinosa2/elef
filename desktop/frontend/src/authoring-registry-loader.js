import { invoke } from "@tauri-apps/api/core"
import builtInRegistry from "./default-authoring-registry.json"
import { mergeAuthoringRegistryEntries } from "./registry-merge.js"
import { setAuthoringRegistryFor } from "controllers/authoring_registry"

const field = document.querySelector("#desktop-editor-field")

function apply(entries) {
  if (!field) return
  const registry = setAuthoringRegistryFor(field, entries)
  field.dataset.authoringRegistry = JSON.stringify(registry)
  for (const identifier of ["snippet-palette", "math-shortcut-palette"]) {
    const controller = globalThis.Stimulus?.getControllerForElementAndIdentifier(field, identifier)
    if (controller) controller.registry = registry
  }
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
