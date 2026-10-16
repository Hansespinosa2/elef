// The source editor keeps Tab: CodeMirror's default keymap binds no Tab key,
// so without this the browser moves focus out of the editor on Tab. One
// binding covers every caret context — Tab indents the selected lines (a
// list item becomes a subitem), Shift+Tab outdents back. Palette Tab-confirm
// and snippet-stop jumps keep priority through their capture-phase keydown
// handlers, which preventDefault before the keymap runs.
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export const editorTabBinding: KeyBinding = indentWithTab;

export const editorTabKeymap: Extension = keymap.of([indentWithTab]);
