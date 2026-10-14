import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Scratch directories for the identity probes must be canonical: the Rust
// library store canonicalizes its root (Library::open), so a symlinked
// TMPDIR such as macOS /var/folders would otherwise never string-match the
// expected root the probe asserts. Resolving here keeps both sides identical.
export function makeCanonicalScratch(prefix, base = tmpdir()) {
  return realpathSync(mkdtempSync(path.join(base, prefix)))
}
