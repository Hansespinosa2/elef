const PREVIEW_FIELDS = ["source", "title", "theme", "typography"]

export interface PreviewField {
  name?: string | null;
  disabled?: boolean;
  value: string;
}

export function buildPreviewRequestBody(fields: Iterable<PreviewField | null | undefined>): FormData {
  const body = new FormData()

  for (const field of fields) {
    if (!field?.name || field.disabled || !PREVIEW_FIELDS.some((name) => field.name?.endsWith(`[${name}]`) ?? false)) continue
    body.set(field.name, field.value)
  }

  return body
}
