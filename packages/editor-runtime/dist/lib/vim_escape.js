import { Vim } from "@replit/codemirror-vim";
function editorPopupOpen(editor) {
  const palettes = editor?.element?.querySelectorAll?.('[role="listbox"]');
  if (!palettes) return false;
  for (let index = 0; index < palettes.length; index += 1) {
    if (palettes[index]?.hidden === false) return true;
  }
  return false;
}
function forwardEscapeToVim(editor, event) {
  if (event.elefEscapeForwarded) return false;
  event.elefEscapeForwarded = true;
  try {
    if (!editor?.vimEnabled || !editor.vim || !editor.insertMode) return false;
    Vim.handleKey(editor.vim, "<Esc>", "user");
    return true;
  } catch (_error) {
    return false;
  }
}
export {
  editorPopupOpen,
  forwardEscapeToVim
};
