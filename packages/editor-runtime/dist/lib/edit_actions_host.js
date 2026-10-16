import { mountEditActions, renderKeyboardReference } from "@elef/client";
function mountHostEditActions(form, getEditor, host) {
  const field = form.querySelector(".source-field");
  if (!field) return null;
  return mountEditActions({ field, getEditor, host, renderReference: renderKeyboardReference });
}
export {
  mountHostEditActions
};
