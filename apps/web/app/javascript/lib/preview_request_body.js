const PREVIEW_FIELDS = ["source", "title", "theme", "typography"]

export function buildPreviewRequestBody(fields) {
  const body = new FormData()

  for (const field of fields) {
    if (!field?.name || field.disabled || !PREVIEW_FIELDS.some((name) => field.name.endsWith(`[${name}]`))) continue
    body.set(field.name, field.value)
  }

  return body
}
