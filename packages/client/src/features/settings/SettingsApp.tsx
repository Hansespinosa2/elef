import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, NoticeTone } from "../../application/types.js";
import type { DeviceStorage } from "./vimPreferences.js";
import { AuthoringDialog } from "./AuthoringDialog.js";
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

type SettingsSection = "appearance" | "keyboard" | "authoring" | "updates";

export function SettingsApp({
  host,
  options,
  storage,
  editorBridge,
  onSaved,
  registerControl,
}: SettingsAppProps): JSX.Element {
  const [theme, setTheme] = useState("dark");
  const [typography, setTypography] = useState("book");
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [appearanceNotice, setAppearanceNotice] = useState<{
    message: string;
    tone: NoticeTone;
  } | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("info");
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [authoringVisited, setAuthoringVisited] = useState(false);

  const showNotice = useCallback(
    (message: string | null, tone: NoticeTone = "info") => {
      setNotice(message ?? "");
      setNoticeTone(tone);
    },
    [],
  );

  const load = useCallback(async () => {
    setReady(false);
    setLoadFailed(false);
    try {
      const current = await host.settings.getSettings();
      // The pre-parity desktop named the follow-the-system theme "system";
      // the shared page calls it "match" (web vocabulary).
      const storedTheme = settingText(current["theme"], "dark");
      setTheme(storedTheme === "system" ? "match" : storedTheme);
      setTypography(settingText(current["typography"], "book"));
      setReady(true);
    } catch {
      setLoadFailed(true);
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
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await host.settings.updateSettings({ theme, typography });
      setTheme(settingText(updated["theme"], theme));
      setTypography(settingText(updated["typography"], typography));
      setAppearanceNotice({
        message: "Workspace appearance saved.",
        tone: "info",
      });
      onSaved?.(updated);
    } catch {
      setAppearanceNotice({
        message: "Workspace appearance could not be saved.",
        tone: "error",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const showUpdater =
    host.capabilities.updater && options.updater !== undefined;
  const visibleSections: readonly SettingsSection[] = showUpdater
    ? ["appearance", "keyboard", "authoring", "updates"]
    : ["appearance", "keyboard", "authoring"];

  function selectSection(next: SettingsSection): void {
    setSection(next);
    if (next === "authoring") setAuthoringVisited(true);
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    const idx = visibleSections.indexOf(section);
    let nextIdx = -1;
    if (event.key === "ArrowRight") {
      nextIdx = (idx + 1) % visibleSections.length;
    } else if (event.key === "ArrowLeft") {
      nextIdx = (idx - 1 + visibleSections.length) % visibleSections.length;
    } else if (event.key === "Home") {
      nextIdx = 0;
    } else if (event.key === "End") {
      nextIdx = visibleSections.length - 1;
    }
    if (nextIdx === -1) return;
    event.preventDefault();
    const next = visibleSections[nextIdx]!;
    selectSection(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  }

  return (
    <div className="settings-page settings-shell">
      <aside className="settings-rail" aria-label="Settings sections">
        <section className="settings-heading">
          <h1 id="settings-title">Settings</h1>
        </section>
        <nav
          className="settings-tabs"
          role="tablist"
          aria-label="Settings categories"
          onKeyDown={onTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            id="settings-tab-appearance"
            aria-selected={section === "appearance"}
            aria-controls="settings-panel-appearance"
            tabIndex={section === "appearance" ? 0 : -1}
            className={`settings-tab${section === "appearance" ? " is-active" : ""}`}
            onClick={() => selectSection("appearance")}
          >
            Appearance
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-keyboard"
            aria-selected={section === "keyboard"}
            aria-controls="settings-panel-keyboard"
            tabIndex={section === "keyboard" ? 0 : -1}
            className={`settings-tab${section === "keyboard" ? " is-active" : ""}`}
            onClick={() => selectSection("keyboard")}
          >
            Keyboard &amp; Vim
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-authoring"
            aria-selected={section === "authoring"}
            aria-controls="settings-panel-authoring"
            tabIndex={section === "authoring" ? 0 : -1}
            className={`settings-tab${section === "authoring" ? " is-active" : ""}`}
            onClick={() => selectSection("authoring")}
          >
            Snippets &amp; Math shortcuts
          </button>
          {showUpdater ? (
            <button
              type="button"
              role="tab"
              id="settings-tab-updates"
              aria-selected={section === "updates"}
              aria-controls="settings-panel-updates"
              tabIndex={section === "updates" ? 0 : -1}
              className={`settings-tab${section === "updates" ? " is-active" : ""}`}
              onClick={() => selectSection("updates")}
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
        <>
          <div
            hidden={section !== "appearance"}
            id="settings-panel-appearance"
            role="tabpanel"
            aria-labelledby="settings-tab-appearance"
            className={
              section === "appearance" ? "is-focused-section" : undefined
            }
          >
            {!ready ? (
              loadFailed ? (
                <p role="alert">
                  Settings could not be loaded.{" "}
                  <button type="button" onClick={() => void load()}>
                    Retry
                  </button>
                </p>
              ) : (
                <p>Loading settings…</p>
              )
            ) : (
              <>
                {appearanceNotice ? (
                  <p
                    role="status"
                    data-tone={appearanceNotice.tone}
                    className="settings-notice"
                  >
                    {appearanceNotice.message}
                  </p>
                ) : null}
                <p className="settings-description">
                  New and unstyled works use these values.
                </p>
                <form
                  onSubmit={(event) => void saveDefaults(event)}
                  className="settings-defaults-form"
                >
                  <fieldset
                    disabled={saving}
                    className="settings-defaults-fields"
                  >
                    <div>
                      <div className="field">
                        <label
                          htmlFor="settings-theme"
                          className="mb-1 block font-extrabold"
                        >
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
                              {choice === "match"
                                ? "Match workspace"
                                : choice[0]!.toUpperCase() + choice.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label
                          htmlFor="settings-typography"
                          className="mb-1 block font-extrabold"
                        >
                          Default typography
                        </label>
                        <select
                          id="settings-typography"
                          value={typography}
                          onChange={(event) =>
                            setTypography(event.target.value)
                          }
                          className="settings-control w-full rounded-xl border p-3"
                        >
                          {TYPOGRAPHY_CHOICES.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice[0]!.toUpperCase() + choice.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <figure className="settings-appearance-proof">
                      <figcaption>Sample document</figcaption>
                      <div
                        className={`settings-proof-sample document-reader document-theme-${theme} document-typography-${typography} work-theme-${theme} work-typography-${typography}`}
                      >
                        <div className="document-surface">
                          <h2>A little room to think</h2>
                          <p>Every good idea begins with a few words.</p>
                        </div>
                      </div>
                    </figure>
                  </fieldset>
                  <div className="settings-feedback">
                    <button
                      type="submit"
                      className="button primary"
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save workspace defaults"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          <div
            hidden={section !== "keyboard"}
            id="settings-panel-keyboard"
            role="tabpanel"
            aria-labelledby="settings-tab-keyboard"
            className={
              section === "keyboard" ? "is-focused-section" : undefined
            }
          >
            <VimSettings
              {...(storage === undefined ? {} : { storage })}
              {...(editorBridge === undefined || editorBridge === null
                ? {}
                : { editorBridge })}
            />
          </div>

          <div
            id="settings-panel-authoring"
            role="tabpanel"
            aria-labelledby="settings-tab-authoring"
            hidden={section !== "authoring"}
          >
            {authoringVisited && options.authoring ? (
              <AuthoringDialog {...options.authoring} inline />
            ) : authoringVisited ? (
              <p>Authoring settings are unavailable.</p>
            ) : null}
          </div>
          {showUpdater && options.updater ? (
            <div
              hidden={section !== "updates"}
              id="settings-panel-updates"
              role="tabpanel"
              aria-labelledby="settings-tab-updates"
              className={
                section === "updates" ? "is-focused-section" : undefined
              }
            >
              <UpdaterSection seam={options.updater} />
            </div>
          ) : null}
        </>
      </div>
    </div>
  );
}
