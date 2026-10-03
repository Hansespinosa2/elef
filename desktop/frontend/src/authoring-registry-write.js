export async function writeAuthoringRegistry({
  registry,
  entries,
  baseHash,
  invoke,
  updateLocal,
  reloadEditorRegistry,
  isSelected,
  onSuccess,
  onFailure
}) {
  try {
    const result = await invoke("write_authoring_registry", {
      registry,
      entries,
      baseHash
    })
    updateLocal({ registry, entries, contentHash: result.content_hash })
    await reloadEditorRegistry()
    onSuccess({ registry, isSelected: isSelected(registry) })
    return true
  } catch (error) {
    onFailure(error, { registry, isSelected: isSelected(registry) })
    return false
  }
}
