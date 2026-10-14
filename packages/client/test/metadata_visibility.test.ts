import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeviceStorage } from "../src/features/settings/vimPreferences.js";
import {
  METADATA_VISIBLE_STORAGE_KEY,
  readMetadataVisible,
  writeMetadataVisible,
} from "../src/features/settings/vimPreferences.js";

function memoryStorage(seed: Record<string, string> = {}): DeviceStorage {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe("source metadata visibility preference", () => {
  it("is visible by default so new Works show metadata", () => {
    assert.equal(readMetadataVisible(memoryStorage()), true);
  });

  it("persists globally under one frozen key across Works", () => {
    const storage = memoryStorage();
    assert.equal(METADATA_VISIBLE_STORAGE_KEY, "elef.editor.metadata.visible");
    writeMetadataVisible(false, storage);
    assert.equal(storage.getItem(METADATA_VISIBLE_STORAGE_KEY), "false");
    // A second editor instance (another Work) reads the same device key.
    assert.equal(readMetadataVisible(storage), false);
    writeMetadataVisible(true, storage);
    assert.equal(readMetadataVisible(storage), true);
  });

  it("treats only an explicit false as hidden", () => {
    assert.equal(readMetadataVisible(memoryStorage({ [METADATA_VISIBLE_STORAGE_KEY]: "false" })), false);
    assert.equal(readMetadataVisible(memoryStorage({ [METADATA_VISIBLE_STORAGE_KEY]: "true" })), true);
    assert.equal(readMetadataVisible(memoryStorage({ [METADATA_VISIBLE_STORAGE_KEY]: "bogus" })), true);
  });
});
