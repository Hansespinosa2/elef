// DELIBERATE CANARY (R1): a contracts source importing an executable host
// package. The boundary checker must reject this file in --self-test.
import type { invoke } from "@tauri-apps/api/core";

export async function canary(): Promise<void> {
  await invoke("canary");
}
