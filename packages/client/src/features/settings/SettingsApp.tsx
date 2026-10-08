import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX, KeyboardEvent } from "react";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, NoticeTone, UpdaterStatus } from "../../application/types.js";
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

export interface SettingsControl {
  reload(): Promise<void>;
  notify(message: string | null, tone?: NoticeTone): void;
}

export interface SettingsAppProps {
  readonly host: ElefHost;
  readonly options: ElefMountOptions;
  readonly storage?: DeviceStorage | null;
  readonly registerControl?: (control: SettingsControl) => void;
}

const THEME_CHOICES = ["match", "light", "dark"] as const;
const TYPOGRAPHY_CHOICES = ["book", "modern", "technical"] as const;

function settingText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function SettingsApp({ host, options, storage, registerControl }: SettingsAppProps): JSX.Element {
  const [theme, setTheme] = useState("dark");
  const [typography, setTypography] = useState("book");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("info");
  const [vimEnabled, setVimEnabled] = useState(false);
  const [escapeKey, setEscapeKey] = useState("");
  const [lineNumberMode, setLineNumberMode] = useState<LineNumberMode>("absolute");
  const [modeAwareCursor, setModeAwareCursor] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);

  const showNotice = useCallback((message: string | null, tone: NoticeTone = "info") => {
    setNotice(message ?? "");
    setNoticeTone(tone);
  }, []);

  const load = useCallback(async () => {
    setReady(false);
    try {
      const current = await host.settings.getSettings();
      setTheme(settingText(current["theme"], "dark"));
      setTypography(settingText(current["typography"], "book"));
      const vim = readVimPreferences(storage);
      setVimEnabled(vim.vimEnabled);
      setEscapeKey(vim.escapeKey);
      setLineNumberMode(vim.lineNumberMode);
      setModeAwareCursor(vim.modeAwareCursor);
      setUpdaterStatus(null);
      setReady(true);
      // The updater endpoint can take seconds; it must never delay the
      // settings form. Load availability in the background after first paint.
      if (host.capabilities.updater && options.updater) {
        try {
          setUpdaterStatus(await options.updater.status());
        } catch {
          setUpdaterStatus(null);
        }
      }
    } catch {
      showNotice("Settings could not be loaded.", "error");
    }
  }, [host, options.updater, storage, showNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    registerControl?.({
      reload: load,
      notify: showNotice,
    });
  }, [registerControl, load, showNotice]);

  async function saveDefaults(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const updated = await host.settings.updateSettings({ theme, typography });
      setTheme(settingText(updated["theme"], theme));
      setTypography(settingText(updated["typography"], typography));
      showNotice("Workspace appearance saved.");
    } catch {
      showNotice("Workspace appearance could not be saved.", "error");
    }
  }

  function toggleVim(enabled: boolean): void {
    setVimEnabled(enabled);
    writeBoolean(ENABLED_STORAGE_KEY, enabled, storage);
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
  }

  function clearEscapeKey(): void {
    setEscapeKey("");
    writeValue(ESCAPE_KEY_STORAGE_KEY, "", storage);
  }

  function changeLineNumbers(mode: string): void {
    const normalized = normalizeLineNumberMode(mode);
    setLineNumberMode(normalized);
    writeValue(LINE_NUMBERS_STORAGE_KEY, normalized, storage);
  }

  function toggleModeAwareCursor(enabled: boolean): void {
    setModeAwareCursor(enabled);
    writeBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, enabled, storage);
  }

  async function recheckUpdates(): Promise<void> {
    if (!options.updater) return;
    try {
      setUpdaterStatus(await options.updater.checkForUpdate());
    } catch {
      showNotice("Could not check for updates.", "error");
    }
  }

  const showUpdater = host.capabilities.updater && options.updater !== undefined;

  return (
    <div className="settings-page">
      <section className="page-title mb-8">
        <p className="eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em]">Workspace defaults</p>
        <h1 className="mb-2 text-4xl font-bold">Settings</h1>
        <p>New and unstyled works use these values. Each work can override them in its editor.</p>
      </section>
      {notice !== "" ? (
        <p role="status" data-tone={noticeTone} className="settings-notice">
          {notice}
        </p>
      ) : null}
      {!ready ? (
        <p>Loading settings…</p>
      ) : (
        <>
          <form
            onSubmit={(event) => void saveDefaults(event)}
            className="settings-card max-w-2xl rounded-2xl border p-6 mb-8"
          >
            <div className="field mb-5">
              <label htmlFor="settings-theme" className="mb-1 block font-extrabold">
                Default theme
              </label>
              <select
                id="settings-theme"
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                className="settings-control w-full rounded-xl border p-3"
              >
                {THEME_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </div>
            <div className="field mb-5">
              <label htmlFor="settings-typography" className="mb-1 block font-extrabold">
                Default typography
              </label>
              <select
                id="settings-typography"
                value={typography}
                onChange={(event) => setTypography(event.target.value)}
                className="settings-control w-full rounded-xl border p-3"
              >
                {TYPOGRAPHY_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="button primary">
              Save workspace defaults
            </button>
          </form>

          <section aria-label="Vim settings" className="settings-card max-w-2xl rounded-2xl border p-6 mb-8">
            <h2 className="text-xl font-bold">Vim settings</h2>
            <p className="text-sm">Configure Vim mode and source editor preferences for this device.</p>
            <div className="field mb-5">
              <label className="flex items-center gap-3 font-extrabold cursor-pointer">
                <input
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
              <label className="flex items-center gap-3 font-extrabold cursor-pointer">
                <input
                  type="checkbox"
                  checked={modeAwareCursor}
                  onChange={(event) => toggleModeAwareCursor(event.target.checked)}
                  className="rounded"
                />
                <span>Mode-aware cursor styling</span>
              </label>
            </div>
          </section>

          {showUpdater ? (
            <section aria-label="Updates" className="settings-card max-w-2xl rounded-2xl border p-6 mb-8">
              <h2 className="text-xl font-bold">Updates</h2>
              <p className="text-sm">
                {updaterStatus === null
                  ? "Update status is unavailable."
                  : updaterStatus.available
                    ? `An update is available${updaterStatus.version ? ` (${updaterStatus.version})` : ""}.`
                    : "This copy is up to date."}
              </p>
              <button type="button" onClick={() => void recheckUpdates()} className="button">
                Check for updates
              </button>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
