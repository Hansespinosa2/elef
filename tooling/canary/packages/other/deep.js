// DELIBERATE CANARY (R2): a cross-package deep import beneath the public
// entry. The boundary checker must reject this file in --self-test.
import { WorkKind } from "../contracts/src/ids.js";

export const canaryKind = WorkKind;
