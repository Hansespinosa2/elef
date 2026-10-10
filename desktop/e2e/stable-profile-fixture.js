import { readFileSync } from "node:fs"

export const STABLE_PROFILE_DECK_TITLE = "E2E stable profile"
export const STABLE_PROFILE_SOURCE = readFileSync(
  new URL("../../test/fixtures/desktop/release/unknown-directives.md", import.meta.url),
  "utf8"
)

export const STABLE_PROFILE_EDITED_SOURCE = `${STABLE_PROFILE_SOURCE}\nSaved by the Stable profile smoke.\n`
export const STABLE_PROFILE_OPEN_LINK_SOURCE = `${STABLE_PROFILE_EDITED_SOURCE}[[]]`
export const STABLE_PROFILE_KEYBOARD_SOURCE = `${STABLE_PROFILE_EDITED_SOURCE}[[Future Release Notes]]`
