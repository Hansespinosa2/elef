// DELIBERATE CANARY (R6/R7): a work-model source importing a host module
// and touching the DOM. The boundary checker must reject this in --self-test.
import fs from "node:fs"

export function canary() {
  return [fs, document.createElement("div")]
}
