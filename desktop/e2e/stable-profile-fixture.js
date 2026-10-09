export const STABLE_PROFILE_DECK_TITLE = "E2E stable profile"

export const STABLE_PROFILE_SOURCE = [
  "---",
  'elef_document_key: "e2e-stable-profile-unknown"',
  "---",
  "",
  "# Stable source",
  "",
  "Unknown syntax stays literal: [[E2E linked]].",
  "",
  "[Ordinary Markdown](https://example.com)",
  ""
].join("\n")

export const STABLE_PROFILE_EDITED_SOURCE = `${STABLE_PROFILE_SOURCE}\nSaved by the Stable profile smoke.\n`
export const STABLE_PROFILE_KEYBOARD_SOURCE = `${STABLE_PROFILE_EDITED_SOURCE}[[`
