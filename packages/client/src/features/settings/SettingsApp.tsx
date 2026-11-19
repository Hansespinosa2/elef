import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, NoticeTone } from "../../application/types.js";
import type { DeviceStorage } from "./vimPreferences.js";
import { UpdaterSection } from "./UpdaterSection.js";
import type { VimEditorBridge } from "./VimSettings.js";
import { VimSettings } from "./VimSettings.js";

export interface SettingsControl {
  reload(): Promise<void>;
  notify(message: string | null, tone?: NoticeTone): void;
}

export interface SettingsAppProps {
  readonly host: ElefHost;
  readonly options: ElefMountOptions;
  readonly storage?: DeviceStorage | null;
  readonly editorBridge?: VimEditorBridge | null;
  readonly onSaved?: (settings: Record<string, unknown>) => void;
  readonly registerControl?: (control: SettingsControl) => void;
}

const THEME_CHOICES = ["match", "light", "dark"] as const;
const TYPOGRAPHY_CHOICES = ["book", "modern", "technical"] as const;

function settingText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

type SettingsSection = "appearance" | "keyboard" | "updates";

export function SettingsApp({ host, options, storage, editorBridge, onSaved, registerControl }: SettingsAppProps): JSX.Element {
  const [theme, setTheme] = useState("dark");
  const [typography, setTypography] = useState("book");
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("info");
  const [section, setSection] = useState<SettingsSection>("appearance");

  const showNotice = useCallback((message: string | null, tone: NoticeTone = "info") => {
    setNotice(message ?? "");
    setNoticeTone(tone);
  }, []);

  const load = useCallback(async () => {
    setReady(false);
    try {
      const current = await host.settings.getSettings();
      // The pre-parity desktop named the follow-the-system theme "system";
      // the shared page calls it "match" (web vocabulary).
      const storedTheme = settingText(current["theme"], "dark");
      setTheme(storedTheme === "system" ? "match" : storedTheme);
      setTypography(settingText(current["typography"], "book"));
      setReady(true);
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
      onSaved?.(updated);
    } catch {
      showNotice("Workspace appearance could not be saved.", "error");
    }
  }

  const showUpdater = host.capabilities.updater && options.updater !== undefined;

  return (
    <div className="settings-page settings-arc-shell">
      <aside className="settings-rail" aria-label="Settings sections">
        <section className="page-title mb-6">
          <p className="eyebrow mb-1 text-xs font-extrabold uppercase tracking-[0.12em]">Workspace defaults</p>
          <h1 className="mb-1 text-3xl font-bold">Settings</h1>
          <p className="text-sm opacity-75">New and unstyled works use these values.</p>
        </section>
        <nav className="settings-tabs" aria-label="Settings categories">
          <button
            type="button"
            className={`settings-tab${section === "appearance" ? " is-active" : ""}`}
            aria-pressed={section === "appearance"}
            onClick={() => setSection("appearance")}
          >
            Appearance
          </button>
          <button
            type="button"
            className={`settings-tab${section === "keyboard" ? " is-active" : ""}`}
            aria-pressed={section === "keyboard"}
            onClick={() => setSection("keyboard")}
          >
            Keyboard &amp; Vim
          </button>
          {options.navigate !== undefined ? (
            <button
              type="button"
              className="settings-tab"
              onClick={() => options.navigate?.({ url: "/snippets" })}
            >
              Snippets &amp; Math
            </button>
          ) : null}
          {showUpdater ? (
            <button
              type="button"
              className={`settings-tab${section === "updates" ? " is-active" : ""}`}
              aria-pressed={section === "updates"}
              onClick={() => setSection("updates")}
            >
              Updates
            </button>
          ) : null}
        </nav>
      </aside>

      <div className="settings-stage">
        {notice !== "" ? (
          <p role="status" data-tone={noticeTone} className="settings-notice">
            {notice}
          </p>
        ) : null}
        {!ready ? (
          <p>Loading settings…</p>
        ) : (
          <>
            <div hidden={section !== "appearance"}>
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
            </div>

            <div hidden={section !== "keyboard"}>
              <VimSettings
                {...(storage === undefined ? {} : { storage })}
                {...(editorBridge === undefined || editorBridge === null ? {} : { editorBridge })}
              />
            </div>

            {showUpdater && options.updater ? (
              <div hidden={section !== "updates"}>
                <UpdaterSection seam={options.updater} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
