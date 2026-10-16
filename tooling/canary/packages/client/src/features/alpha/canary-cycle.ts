// DELIBERATE CANARY (R10): a feature importing across features/. The
// boundary checker must reject this in --self-test.
import { beta } from "../beta/canary-cycle.js";

export function alpha(): string {
  return `alpha:${beta()}`;
}
