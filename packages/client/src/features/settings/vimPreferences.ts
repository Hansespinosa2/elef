// Device-local vim/editor preferences shared by the settings UI and the editor.
// Storage keys are frozen: both hosts and the pre-migration settings surfaces
// read and write the same keys, so renaming one orphans existing preferences.
// The pure helpers (naming, validation, display) live here rather than being
// copied per surface. Persistence is injectable; the default is DOM
// localStorage, which both hosts provide.

export const ENABLED_STORAGE_KEY = "elef.editor.vim.enabled";
export const ESCAPE_KEY_STORAGE_KEY = "elef.editor.vim.escapeKey";
const LEGACY_ESCAPE_ALIAS_STORAGE_KEY = "elef.editor.vim.escapeAlias";
export const LINE_NUMBERS_STORAGE_KEY = "elef.editor.lineNumbers";
export const MODE_AWARE_CURSOR_STORAGE_KEY = "elef.editor.vim.modeAwareCursor";
const SHIFT_SPACE = "<S-Space>";

export type LineNumberMode = "absolute" | "relative" | "off";

export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): DeviceStorage | null {
  try {
    const candidate = (globalThis as Record<string, unknown>)["localStorage"];
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as DeviceStorage).getItem === "function" &&
      typeof (candidate as DeviceStorage).setItem === "function"
    ) {
      return candidate as DeviceStorage;
    }
    return null;
  } catch {
    return null;
  }
}

function readValue(key: string, storage: DeviceStorage | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeValue(key: string, value: string, storage?: DeviceStorage | null): void {
  try {
    (storage ?? defaultStorage())?.setItem(key, value);
  } catch {
    // Private browsing and blocked storage should not disable editing.
  }
}

export function readBoolean(key: string, storage?: DeviceStorage | null): boolean {
  return readValue(key, storage ?? defaultStorage()) === "true";
}

export function writeBoolean(key: string, value: boolean, storage?: DeviceStorage | null): void {
  writeValue(key, String(value), storage ?? defaultStorage());
}

const VIM_KEY_NAMES: Readonly<Record<string, string>> = {
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backspace: "BS",
  Enter: "CR",
  Delete: "Del",
  Escape: "Esc",
  Insert: "Ins",
  PageDown: "PageDown",
  PageUp: "PageUp",
};

const VIM_MODIFIER_NAMES: Readonly<Record<string, string>> = {
  A: "Alt",
  C: "Ctrl",
  M: "Meta",
  S: "Shift",
};

export function normalizeEscapeKey(value: string): string {
  if (typeof value !== "string" || value.length === 0) return "";
  if (value.startsWith("<")) return /^(?:<(?:[CSMA]-)*[A-Za-z0-9]+>)+$/.test(value) ? value : "";
  return Array.from(value).length === 1 ? value : "";
}

export function normalizeLineNumberMode(value: string): LineNumberMode {
  return value === "relative" || value === "off" ? value : "absolute";
}

export function escapeKeyDisplay(key: string): string {
  if (!key) return "";
  if (!key.startsWith("<")) return key;
  return key
    .slice(1, -1)
    .split("-")
    .map((part) => VIM_MODIFIER_NAMES[part] || part)
    .join("+");
}

export interface VimKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export function vimKeyFromEvent(event: VimKeyEvent): string {
  if (["Shift", "Control", "Alt", "Meta", "Unidentified"].includes(event.key)) return "";

  const isLetter = /^[A-Za-z]$/.test(event.key);
  let key = VIM_KEY_NAMES[event.key] || event.key;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("C");
  if (event.shiftKey && (Array.from(event.key).length === 0 || key.length > 1 || isLetter)) {
    modifiers.push("S");
  }
  if (event.altKey) modifiers.push("A");
  if (event.metaKey) modifiers.push("M");
  if (event.shiftKey && isLetter) key = key.toLowerCase();

  if (Array.from(key).length !== 1 || modifiers.length > 0) {
    return `<${modifiers.join("-")}${modifiers.length > 0 ? "-" : ""}${key}>`;
  }
  return key;
}

export function readEscapeKey(storage?: DeviceStorage | null): string {
  const store = storage ?? defaultStorage();
  const saved = readValue(ESCAPE_KEY_STORAGE_KEY, store);
  if (saved !== null) return normalizeEscapeKey(saved);
  return readValue(LEGACY_ESCAPE_ALIAS_STORAGE_KEY, store) === "shift-space" ? SHIFT_SPACE : "";
}

export function readLineNumberMode(storage?: DeviceStorage | null): LineNumberMode {
  return normalizeLineNumberMode(readValue(LINE_NUMBERS_STORAGE_KEY, storage ?? defaultStorage()) || "absolute");
}

export interface VimPreferences {
  readonly vimEnabled: boolean;
  readonly escapeKey: string;
  readonly lineNumberMode: LineNumberMode;
  readonly modeAwareCursor: boolean;
}

export function readVimPreferences(storage?: DeviceStorage | null): VimPreferences {
  const store = storage ?? defaultStorage();
  return {
    vimEnabled: readBoolean(ENABLED_STORAGE_KEY, store),
    escapeKey: readEscapeKey(store),
    lineNumberMode: readLineNumberMode(store),
    modeAwareCursor: readBoolean(MODE_AWARE_CURSOR_STORAGE_KEY, store),
  };
}
