// DELIBERATE CANARY (R4): an adapter binding the Tauri package directly
// instead of using the injected transport. The checker must reject it.
import { invoke } from "@tauri-apps/api/core";

export function canaryInvoke(command) {
  return invoke(command);
}
