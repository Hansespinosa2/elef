const PREVIEW_FIELDS = ["source", "title", "theme", "typography"];
function buildPreviewRequestBody(fields) {
  const body = new FormData();
  for (const field of fields) {
    if (!field?.name || field.disabled || !PREVIEW_FIELDS.some((name) => field.name?.endsWith(`[${name}]`) ?? false)) continue;
    body.set(field.name, field.value);
  }
  return body;
}
export {
  buildPreviewRequestBody
};
