export interface ConflictDialogOptions {
  message?: string;
  localSource?: string;
  diskSource?: string;
  diskSourceFile?: string;
  mergeSource?: string | null;
}

export function presentConflictDialog(dialog: HTMLDialogElement | null, {
  message = "",
  localSource = "",
  diskSource = "",
  diskSourceFile = "",
  mergeSource = localSource
}: ConflictDialogOptions = {}) {
  if (!dialog) return false

  const text = (selector: string, value: unknown) => {
    const element = dialog.querySelector(selector)
    if (element) element.textContent = value == null ? "" : String(value)
  }

  text("#conflict-message", message)
  text("#conflict-local", localSource)
  text("#conflict-disk", diskSource)
  text("#conflict-source-name", diskSourceFile)

  const merge = dialog.querySelector("#conflict-merge") as HTMLInputElement | null
  if (merge) merge.value = mergeSource == null ? "" : String(mergeSource)
  if (!dialog.open) dialog.showModal()
  return true
}
