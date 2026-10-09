import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const PIXEL_PNG_BYTES = readFileSync(new URL("../../fixtures/desktop/release/images/release-pixel.png", import.meta.url))
export const PIXEL_PNG_DIGEST = createHash("sha256").update(PIXEL_PNG_BYTES).digest("hex")
export const PIXEL_PNG_MARKDOWN = `![pixel](elef-asset:${PIXEL_PNG_DIGEST} \"fit:contain\")`
