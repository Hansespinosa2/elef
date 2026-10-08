import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, NoticeTone } from "../../application/types.js";
import type { DeviceStorage } from "./vimPreferences.js";
import { UpdaterSection } from "./UpdaterSection.js";
import { VimSettings } from "./VimSettings.js";

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
    } catch {
      showNotice("Workspace appearance could not be saved.", "error");
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

          <VimSettings {...(storage === undefined ? {} : { storage })} />

          {showUpdater && options.updater ? <UpdaterSection seam={options.updater} /> : null}
        </>
      )}
    </div>
  );
}
