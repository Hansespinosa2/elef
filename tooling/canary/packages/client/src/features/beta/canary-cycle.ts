// DELIBERATE CANARY (R10): closes the import cycle with alpha. The
// boundary checker must reject this in --self-test.
import { alpha } from "../alpha/canary-cycle.js";

export function beta(): string {
  return `beta:${alpha()}`;
}
