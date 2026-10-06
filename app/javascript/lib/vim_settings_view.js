const VIM_SETTINGS_VIEW = `
  <div class="mb-5">
    <h2 class="text-xl font-bold">Vim settings</h2>
    <p class="text-sm text-[#aab7b1]">Configure Vim mode and source editor preferences for this device.</p>
  </div>

  <div class="field mb-5">
    <label class="flex items-center gap-3 font-extrabold cursor-pointer">
      <input type="checkbox" data-vim-settings-target="vimToggle" data-action="change->vim-settings#toggleVim" class="rounded">
      <span>Enable Vim mode</span>
    </label>
  </div>

  <div class="field mb-5">
    <label for="vim_escape_key" class="mb-1 block font-extrabold">Remap Vim Escape</label>
    <div class="flex items-center gap-2">
      <input id="vim_escape_key" type="text" readonly placeholder="Escape (default)" data-vim-settings-target="escapeKey" data-action="keydown->vim-settings#captureEscapeKey" aria-label="Choose a key to remap Vim Escape" class="settings-control rounded-xl border p-3 max-w-xs">
      <button type="button" data-action="vim-settings#clearEscapeKey" class="button inline-flex min-h-10 cursor-pointer items-center rounded-full border border-[#304047] bg-[#202c32] px-4 py-2 font-bold text-[#e9eee9]">Clear</button>
    </div>
    <p class="field-hint">Focus the field and press a key or key combination to set it as Escape in every Vim mode.</p>
  </div>

  <div class="field mb-5">
    <label for="vim_line_numbers" class="mb-1 block font-extrabold">Line numbers</label>
    <select id="vim_line_numbers" data-vim-settings-target="lineNumbers" data-action="change->vim-settings#lineNumbersChanged" class="settings-control rounded-xl border p-3 max-w-xs">
      <option value="absolute">Absolute</option>
      <option value="relative">Relative</option>
      <option value="off">Hidden</option>
    </select>
  </div>

  <div class="field">
    <label class="flex items-center gap-3 font-extrabold cursor-pointer">
      <input type="checkbox" data-vim-settings-target="modeAwareCursor" data-action="change->vim-settings#modeAwareCursorChanged" class="rounded">
      <span>Mode-aware cursor styling</span>
    </label>
  </div>
`

export function mountVimSettingsView(container) {
  if (!container?.ownerDocument) throw new TypeError("Vim settings need a DOM container")
  if (container.querySelector("[data-vim-settings-target='vimToggle']")) return

  const template = container.ownerDocument.createElement("template")
  template.innerHTML = VIM_SETTINGS_VIEW
  container.replaceChildren(template.content)
}
