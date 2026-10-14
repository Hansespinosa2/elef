import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
const editorTabBinding = indentWithTab;
const editorTabKeymap = keymap.of([indentWithTab]);
export {
  editorTabBinding,
  editorTabKeymap
};
