function editorFor(element) {
  return element?.editorController || null;
}
function asEditorSeam(candidate) {
  if (typeof candidate !== "object" || candidate === null) return null;
  const seam = candidate;
  if (typeof seam.value !== "string") return null;
  if (typeof seam.selectionStart !== "number") return null;
  if (typeof seam.selectionEnd !== "number") return null;
  if (typeof seam.selectionHead !== "number") return null;
  if (typeof seam.vimEnabled !== "boolean") return null;
  if (typeof seam.insertMode !== "boolean") return null;
  if (typeof seam.commitSource !== "function") return null;
  if (typeof seam.replaceRange !== "function") return null;
  if (typeof seam.replaceRanges !== "function") return null;
  if (typeof seam.setSelectionRange !== "function") return null;
  if (typeof seam.handleVimKey !== "function") return null;
  return candidate;
}
export {
  asEditorSeam,
  editorFor
};
