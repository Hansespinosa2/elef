// DELIBERATE CANARY (R6/R7): a renderer source importing a non-vendor
// module and emitting editor chrome. Must be rejected in --self-test.
import { query } from "some-dom-helper"

export const canary = `<div contenteditable="true">${query}</div>`
