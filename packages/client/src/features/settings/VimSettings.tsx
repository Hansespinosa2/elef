import { createElement, useEffect, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import type { DeviceStorage, LineNumberMode } from "./vimPreferences.js";
import {
  ENABLED_STORAGE_KEY,
  ESCAPE_KEY_STORAGE_KEY,
  LINE_NUMBERS_STORAGE_KEY,
  MODE_AWARE_CURSOR_STORAGE_KEY,
  escapeKeyDisplay,
  normalizeLineNumberMode,
  readVimPreferences,
  vimKeyFromEvent,
  writeBoolean,
  writeValue,
} from "./vimPreferences.js";

// Live-sync bridge to an open editor on hosts that embed one beside the
// settings UI (desktop). The pre-migration settings controller reached the
// editor through the same DOM lookup; hosts without an editor omit the
// bridge and persistence alone applies, exactly like the settings pages.
export interface VimEditorBridge {
  setVimEnabled(enabled: boolean): void;
  setEscapeKey(key: string): void;
  clearEscapeKey(): void;
  setLineNumberMode(mode: LineNumberMode): void;
  setModeAwareCursor(enabled: boolean): void;
}

export interface VimSettingsProps {
  readonly storage?: DeviceStorage | null;
  readonly editorBridge?: VimEditorBridge | null;
}

// Host entry for embedding the standalone vim preferences (desktop settings
// dialog): hosts never touch React directly — the dist bundle owns it.
export function mountVimSettings(
  container: Element,
  props: VimSettingsProps = {},
): { unmount(): void } {
  const root = createRoot(container);
  root.render(createElement(VimSettings, props));
  return {
    unmount(): void {
      root.unmount();
    },
  };
}

export function VimSettings({ storage, editorBridge }: VimSettingsProps): JSX.Element {
  const [vimEnabled, setVimEnabled] = useState(false);
  const [escapeKey, setEscapeKey] = useState("");
  const [lineNumberMode, setLineNumberMode] = useState<LineNumberMode>("absolute");
  const [modeAwareCursor, setModeAwareCursor] = useState(false);

  useEffect(() => {
    const vim = readVimPreferences(storage);
    setVimEnabled(vim.vimEnabled);
    setEscapeKey(vim.escapeKey);
    setLineNumberMode(vim.lineNumberMode);
    setModeAwareCursor(vim.modeAwareCursor);
  }, [storage]);

  function toggleVim(enabled: boolean): void {
    setVimEnabled(enabled);
    writeBoolean(ENABLED_STORAGE_KEY, enabled, storage);
    editorBridge?.setVimEnabled(enabled);
  }

  function captureEscapeKey(event: KeyboardEvent<HTMLInputElement>): void {
    const key = vimKeyFromEvent({
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    setEscapeKey(key);
    writeValue(ESCAPE_KEY_STORAGE_KEY, key, storage);
    editorBridge?.setEscapeKey(key);
  }

  function clearEscapeKey(): void {
    setEscapeKey("");
    writeValue(ESCAPE_KEY_STORAGE_KEY, "", storage);
    editorBridge?.clearEscapeKey();
  }

  function changeLineNumbers(mode: string): void {
    const normalized = normalizeLineNumberMode(mode);
    setLineNumberMode(normalized);
    writeValue(LINE_NUMBERS_STORAGE_KEY, normalized, storage);
    editorBridge?.setLineNumberMode(normalized);
  }

  function toggleModeAwareCursor(enabled: boolean): void {
    setModeAwareCursor(enabled);
    writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, enabled, storage);
    editorBridge?.setModeAwareCursor(enabled);
  }

  return (
    <section aria-label="Vim settings" className="settings-card max-w-2xl rounded-2xl border p-6 mb-8">
      <h2 className="text-xl font-bold">Vim settings</h2>
      <p className="text-sm">Configure Vim mode and source editor preferences for this device.</p>
      <div className="field mb-5">
        <label htmlFor="vim-enabled" className="flex items-center gap-3 font-extrabold cursor-pointer">
          <input
            id="vim-enabled"
            type="checkbox"
            checked={vimEnabled}
            onChange={(event) => toggleVim(event.target.checked)}
            className="rounded"
          />
          <span>Enable Vim mode</span>
        </label>
      </div>
      <div className="field mb-5">
        <label htmlFor="vim-escape-key" className="mb-1 block font-extrabold">
          Remap Vim Escape
        </label>
        <div className="flex items-center gap-2">
          <input
            id="vim-escape-key"
            type="text"
            readOnly
            placeholder="Escape (default)"
            value={escapeKeyDisplay(escapeKey)}
            onKeyDown={(event) => captureEscapeKey(event)}
            aria-label="Choose a key to remap Vim Escape"
            className="settings-control rounded-xl border p-3 max-w-xs"
          />
          <button type="button" onClick={clearEscapeKey} className="button">
            Clear
          </button>
        </div>
      </div>
      <div className="field mb-5">
        <label htmlFor="vim-line-numbers" className="mb-1 block font-extrabold">
          Line numbers
        </label>
        <select
          id="vim-line-numbers"
          value={lineNumberMode}
          onChange={(event) => changeLineNumbers(event.target.value)}
          className="settings-control rounded-xl border p-3 max-w-xs"
        >
          <option value="absolute">Absolute</option>
          <option value="relative">Relative</option>
          <option value="off">Hidden</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="vim-mode-aware-cursor" className="flex items-center gap-3 font-extrabold cursor-pointer">
          <input
            id="vim-mode-aware-cursor"
            type="checkbox"
            checked={modeAwareCursor}
            onChange={(event) => toggleModeAwareCursor(event.target.checked)}
            className="rounded"
          />
          <span>Mode-aware cursor styling</span>
        </label>
      </div>
    </section>
  );
}
