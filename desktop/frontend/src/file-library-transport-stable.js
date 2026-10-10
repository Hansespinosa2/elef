import { createBaseFileLibraryTransport } from "./file-library-transport-base.js"

export function createFileLibraryTransport({ invoke }) {
  return createBaseFileLibraryTransport({ invoke })
}
