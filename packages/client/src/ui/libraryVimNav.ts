export const LIBRARY_VIM_NAV_STORAGE_KEY = "elef.library.vimNav";

export interface LibraryNavStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultNavStorage(): LibraryNavStorage | null {
  try {
    const candidate = (globalThis as Record<string, unknown>)["localStorage"];
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as LibraryNavStorage).getItem === "function" &&
      typeof (candidate as LibraryNavStorage).setItem === "function"
    ) {
      return candidate as LibraryNavStorage;
    }
    return null;
  } catch {
    return null;
  }
}

export function readLibraryVimNav(storage?: LibraryNavStorage | null): boolean {
  try {
    const saved = (storage ?? defaultNavStorage())?.getItem(LIBRARY_VIM_NAV_STORAGE_KEY) ?? null;
    return saved !== "false";
  } catch {
    return true;
  }
}

export function writeLibraryVimNav(value: boolean, storage?: LibraryNavStorage | null): void {
  try {
    (storage ?? defaultNavStorage())?.setItem(LIBRARY_VIM_NAV_STORAGE_KEY, value ? "true" : "false");
  } catch {
    // Private browsing and blocked storage should not disable navigation.
  }
}
