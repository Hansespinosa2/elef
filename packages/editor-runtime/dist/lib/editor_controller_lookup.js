function editorFor(element) {
  return element?.editorController || null;
}
function asEditorSeam(candidate) {
  if (typeof candidate !== "object" || candidate === null) return null;
  const seam = candidate;
  if (typeof seam.value !== "string") return null;
  if (typeof seam.commitSource !== "function") return null;
  if (typeof seam.replaceRange !== "function") return null;
  if (typeof seam.replaceRanges !== "function") return null;
  return candidate;
}
export {
  asEditorSeam,
  editorFor
};
