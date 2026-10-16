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
function mirrorPopupAccessibility(fieldElement, params) {
  const active = document.activeElement;
  if (!active || active === document.body || !fieldElement.closest("form")?.contains(active)) return;
  active.setAttribute("aria-expanded", String(params.open));
  if (params.selectedId) active.setAttribute("aria-activedescendant", params.selectedId);
  else active.removeAttribute("aria-activedescendant");
}
export {
  mirrorPopupAccessibility,
  placeVisualCaret,
  projectionHostFor,
  visualCaretRect
};
