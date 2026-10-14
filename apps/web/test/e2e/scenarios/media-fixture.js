import { createHash } from "node:crypto"

export const PIXEL_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkWQAAAAASUVORK5CYII=",
  "base64"
)
export const PIXEL_PNG_DIGEST = createHash("sha256").update(PIXEL_PNG_BYTES).digest("hex")
export const PIXEL_PNG_MARKDOWN = `![pixel](elef-asset:${PIXEL_PNG_DIGEST} \"fit:contain\")`
