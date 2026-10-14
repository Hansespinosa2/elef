// DELIBERATE CANARY (R9): a client source importing a host package and
// naming a host global. The boundary checker must reject this in --self-test.
import { invoke } from "@tauri-apps/api/core";

export async function canary(): Promise<void> {
  await invoke("canary", { host: globalThis.__TAURI__ });
}
