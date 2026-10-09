export async function writeAuthoringRegistry({
  registry,
  entries,
  baseHash,
  writeRegistry,
  updateLocal,
  reloadEditorRegistry,
  isSelected,
  onSuccess,
  onFailure
}) {
  try {
    const result = await writeRegistry({
      registry,
      entries,
      baseHash
    })
    updateLocal({ registry, entries: result.entries || entries, contentHash: result.contentHash })
    await reloadEditorRegistry()
    onSuccess({ registry, isSelected: isSelected(registry) })
    return true
  } catch (error) {
    onFailure(error, { registry, isSelected: isSelected(registry) })
    return false
  }
}
