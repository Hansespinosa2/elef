function assistsInMode(editor) {
  return !!editor && (editor.editingMode === "source" || editor.editingMode === "visual");
}
function projectionHostFor(element) {
  const form = element.closest("form");
  return form?.presentationEditorController || form?.visualEditorController || null;
}
function placeVisualCaret(element, sourceOffset) {
  projectionHostFor(element)?.restoreCaret?.(sourceOffset, null);
}
function visualCaretRect() {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect();
  if (!rect || rect.x === 0 && rect.y === 0 && rect.width === 0 && rect.height === 0) return null;
  return rect;
}
function placePaletteBelow(palette, marker) {
  const paletteRect = palette.getBoundingClientRect();
  const left = Math.max(8, Math.min(marker.left, window.innerWidth - paletteRect.width - 8));
  const maxTop = window.innerHeight - paletteRect.height - 8;
  const belowTop = marker.bottom + 4;
  const aboveTop = marker.top - paletteRect.height - 4;
  const top = belowTop <= maxTop ? belowTop : Math.max(8, Math.min(aboveTop, maxTop));
  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
}
function mirrorPopupAccessibility(fieldElement, params) {
  const active = document.activeElement;
  if (!active || active === document.body || !fieldElement.closest("form")?.contains(active)) return;
  active.setAttribute("aria-expanded", String(params.open));
  if (params.selectedId) active.setAttribute("aria-activedescendant", params.selectedId);
  else active.removeAttribute("aria-activedescendant");
}
export {
  assistsInMode,
  mirrorPopupAccessibility,
  placePaletteBelow,
  placeVisualCaret,
  projectionHostFor,
  visualCaretRect
};
