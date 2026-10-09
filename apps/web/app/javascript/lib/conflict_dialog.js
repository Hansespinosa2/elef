export function presentConflictDialog(dialog, {
  message = "",
  localSource = "",
  diskSource = "",
  diskSourceFile = "",
  mergeSource = localSource
} = {}) {
  if (!dialog) return false

  const text = (selector, value) => {
    const element = dialog.querySelector(selector)
    if (element) element.textContent = value == null ? "" : String(value)
  }

  text("#conflict-message", message)
  text("#conflict-local", localSource)
  text("#conflict-disk", diskSource)
  text("#conflict-source-name", diskSourceFile)

  const merge = dialog.querySelector("#conflict-merge")
  if (merge) merge.value = mergeSource == null ? "" : String(mergeSource)
  if (!dialog.open) dialog.showModal()
  return true
}
