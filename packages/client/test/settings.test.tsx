import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { AuthoringSeam, ElefHost, UpdaterSeam } from "../src/index.js";
import { isSettingsRoute, parseSettingsRoute } from "../src/index.js";
import type { DeviceStorage } from "../src/features/settings/vimPreferences.js";
import {
  ENABLED_STORAGE_KEY,
  ESCAPE_KEY_STORAGE_KEY,
  LINE_NUMBERS_STORAGE_KEY,
  MODE_AWARE_CURSOR_STORAGE_KEY,
  escapeKeyDisplay,
  normalizeEscapeKey,
  readVimPreferences,
  vimKeyFromEvent,
} from "../src/features/settings/vimPreferences.js";
import { click, mountInto, submitForm, settled, typedHost } from "./helpers.js";

function memoryStorage(seed: Record<string, string> = {}): DeviceStorage {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

// linkedom's select `value` setter does not track, and React defines its own
// getter-only `value` on controlled nodes: select the option node instead,
// then dispatch change on the select like a user choice.
async function setSelectValue(select: unknown, value: string): Promise<void> {
  const node = select as {
    ownerDocument: Document;
    dispatchEvent: (event: unknown) => void;
    querySelector: (selector: string) => { selected: boolean } | null;
  };
  const option = node.querySelector(`option[value="${value}"]`);
  assert.notEqual(option, null);
  option!.selected = true;
  const event = node.ownerDocument.createEvent("Event");
  event.initEvent("change", true, true);
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

// linkedom checkboxes never toggle on click(): set the state explicitly,
// then dispatch the click React's onChange observes, like a user click.
async function setCheckbox(box: unknown, checked: boolean): Promise<void> {
  const node = box as {
    ownerDocument: Document;
    checked: boolean;
    dispatchEvent: (event: unknown) => void;
  };
  node.checked = checked;
  const event = node.ownerDocument.createEvent("Event");
  event.initEvent("click", true, true);
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

function updaterHost(available: boolean, version?: string): { host: ElefHost; seam: UpdaterSeam } {
  const host = typedHost();
  const withUpdater = {
    ...host,
    capabilities: { ...host.capabilities, updater: true },
  } as ElefHost;
  const seam: UpdaterSeam = {
    status: async () => (version === undefined ? { available } : { available, version }),
    checkForUpdate: async () => (version === undefined ? { available } : { available, version }),
  };
  return { host: withUpdater, seam };
}

describe("settings route", () => {
  it("matches settings paths and hashes, not library routes", () => {
    assert.equal(isSettingsRoute("/settings"), true);
    assert.equal(isSettingsRoute("https://example.test/settings"), true);
    assert.equal(isSettingsRoute("/#settings"), true);
    assert.equal(isSettingsRoute("/snippets"), true);
    assert.equal(isSettingsRoute("/math_shortcuts/abc/edit"), true);
    assert.equal(isSettingsRoute("/"), false);
    assert.equal(isSettingsRoute("/documents"), false);
    assert.equal(isSettingsRoute("/snippets/abc"), false);
    assert.equal(isSettingsRoute("not a url %%%"), false);
  });

  it("parses the authoring pages into registry, new, and edit targets", () => {
    assert.deepEqual(parseSettingsRoute("/settings"), { kind: "defaults" });
    assert.deepEqual(parseSettingsRoute("/snippets"), {
      kind: "authoring",
      registry: "snippets",
      openNew: false,
      entryId: null,
    });
    assert.deepEqual(parseSettingsRoute("/snippets/new"), {
      kind: "authoring",
      registry: "snippets",
      openNew: true,
      entryId: null,
    });
    assert.deepEqual(parseSettingsRoute("/math_shortcuts/abc/edit"), {
      kind: "authoring",
      registry: "math_shortcuts",
      openNew: false,
      entryId: "abc",
    });
    assert.equal(parseSettingsRoute("/documents"), null);
  });

  it("mounts the shared dialog on authoring routes with the host seam", async () => {
    const host = typedHost();
    const seam: AuthoringSeam = {
      transport: {
        readRegistries: async () => ({
          snippets: [{ id: "s1", name: "Note", trigger: "note", category: "Markdown", body: "x" }],
          math_shortcuts: [],
          hashes: {},
        }),
        writeRegistry: async () => ({ contentHash: null }),
      },
    };
    const { document } = await mountInto(host, { initialUrl: "/snippets", authoring: seam });
    assert.notEqual(document.querySelector('section[aria-label="Authoring settings"]'), null);
    assert.equal(document.querySelector("#authoring-settings-count")?.textContent, "1 snippet · 1 personal");
  });

  it("reports honestly when an authoring route has no host seam", async () => {
    const host = typedHost();
    const { document } = await mountInto(host, { initialUrl: "/snippets" });
    assert.equal(document.querySelector('section[aria-label="Authoring settings"]'), null);
    assert.match(document.querySelector('[role="status"]')?.textContent ?? "", /registry transport/);
  });

  it("round-trips workspace defaults through host.settings", async () => {
    const host = typedHost();
    const { document } = await mountInto(host, { initialUrl: "/settings" });
    const theme = document.getElementById("settings-theme") as unknown as HTMLSelectElement;
    const typography = document.getElementById("settings-typography") as unknown as HTMLSelectElement;
    assert.equal(theme.value, "dark");
    await setSelectValue(theme, "light");
    await setSelectValue(typography, "modern");
    const form = theme.closest("form") as unknown;
    await submitForm(form);
    const reread = await host.settings.getSettings();
    assert.equal(reread["theme"], "light");
    assert.equal(reread["typography"], "modern");
    const notice = document.querySelector('[role="status"]');
    assert.equal(notice?.textContent, "Workspace appearance saved.");
  });

  it("names vim keys the way the editor and settings surfaces agree on", () => {
    const plain = { key: "j", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    assert.equal(vimKeyFromEvent(plain), "j");
    assert.equal(vimKeyFromEvent({ ...plain, key: "Shift" }), "");
    assert.equal(vimKeyFromEvent({ ...plain, key: "Escape" }), "<Esc>");
    assert.equal(vimKeyFromEvent({ ...plain, ctrlKey: true }), "<C-j>");
    assert.equal(vimKeyFromEvent({ ...plain, key: "J", shiftKey: true }), "<S-j>");
    assert.equal(escapeKeyDisplay("<C-j>"), "Ctrl+j");
    assert.equal(escapeKeyDisplay("j"), "j");
    assert.equal(normalizeEscapeKey("<C-j>"), "<C-j>");
    assert.equal(normalizeEscapeKey("<bogus key>"), "");
    assert.equal(normalizeEscapeKey("ab"), "");
  });

  it("persists vim preferences to device storage", async () => {
    const host = typedHost();
    const storage = memoryStorage({ [ESCAPE_KEY_STORAGE_KEY]: "j" });
    const scope = globalThis as Record<string, unknown>;
    const previous = scope["localStorage"];
    scope["localStorage"] = storage;
    try {
      const { document } = await mountInto(host, { initialUrl: "/settings" });
      const toggle = document.querySelector('section[aria-label="Vim settings"] input[type="checkbox"]');
      await setCheckbox(toggle, true);
      assert.equal(storage.getItem(ENABLED_STORAGE_KEY), "true");
      const lineNumbers = document.getElementById("vim-line-numbers");
      await setSelectValue(lineNumbers, "relative");
      assert.equal(storage.getItem(LINE_NUMBERS_STORAGE_KEY), "relative");
      const prefs = readVimPreferences(storage);
      assert.equal(prefs.vimEnabled, true);
      assert.equal(prefs.lineNumberMode, "relative");

      // The seeded escape key displays through the shared formatter; the
      // Clear button persists the reset like any other preference write.
      const escapeField = document.getElementById("vim-escape-key") as unknown as { value: string };
      assert.equal(escapeField.value, "j");
      const clearButton = [...document.querySelectorAll('section[aria-label="Vim settings"] button')].find(
        (button) => button.textContent === "Clear",
      );
      await click(clearButton);
      assert.equal(storage.getItem(ESCAPE_KEY_STORAGE_KEY), "");

      const cursorToggle = document.getElementById("vim-mode-aware-cursor");
      await setCheckbox(cursorToggle, true);
      assert.equal(storage.getItem(MODE_AWARE_CURSOR_STORAGE_KEY), "true");
    } finally {
      scope["localStorage"] = previous;
    }
  });

  it("hides the updater affordance when the host has no updater", async () => {
    const host = typedHost();
    assert.equal(host.capabilities.updater, false);
    const { document } = await mountInto(host, { initialUrl: "/settings" });
    assert.equal(document.querySelector('section[aria-label="Updates"]'), null);
  });

  it("shows the updater affordance only for updater-capable hosts", async () => {
    const { host, seam } = updaterHost(true, "9.1.0");
    const { document } = await mountInto(host, { initialUrl: "/settings", updater: seam });
    const section = document.querySelector('section[aria-label="Updates"]');
    assert.notEqual(section, null);
    assert.match(section?.textContent ?? "", /9\.1\.0/);
    const button = section?.querySelector("button");
    await click(button);
    assert.match(section?.textContent ?? "", /update is available/);
  });

  it("shows up-to-date state when no update is available", async () => {
    const { host, seam } = updaterHost(false);
    const { document } = await mountInto(host, { initialUrl: "/settings", updater: seam });
    const section = document.querySelector('section[aria-label="Updates"]');
    assert.match(section?.textContent ?? "", /up to date/);
  });

  it("omits the updater affordance without the seam even when capable", async () => {
    const { host } = updaterHost(true);
    const { document } = await mountInto(host, { initialUrl: "/settings" });
    assert.equal(document.querySelector('section[aria-label="Updates"]'), null);
  });
});
