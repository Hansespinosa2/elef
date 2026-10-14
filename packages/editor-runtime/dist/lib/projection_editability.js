function markProjectionBlocksReadOnly(projection) {
  if (!projection?.querySelectorAll) return;
  projection.querySelectorAll("[data-editor-block-id]").forEach((block) => {
    setProjectionBlockEditable(block, false, "");
  });
}
function setProjectionBlockEditable(block, editable, ariaLabel) {
  setAttribute(block, "contenteditable", String(editable));
  if (editable) {
    setAttribute(block, "role", "textbox");
    setAttribute(block, "aria-label", ariaLabel);
    setAttribute(block, "aria-multiline", "true");
    setAttribute(block, "spellcheck", "true");
    removeAttribute(block, "aria-readonly");
  } else {
    removeAttribute(block, "role");
    removeAttribute(block, "aria-label");
    removeAttribute(block, "aria-multiline");
    removeAttribute(block, "spellcheck");
    setAttribute(block, "aria-readonly", "true");
  }
}
function setAttribute(element, name, value) {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function removeAttribute(element, name) {
  if (element.hasAttribute(name)) element.removeAttribute(name);
}
export {
  markProjectionBlocksReadOnly,
  setProjectionBlockEditable
};
