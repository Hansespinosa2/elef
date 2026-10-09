// Single source of truth for user-facing export formats (P07-06): which
// formats exist, which Work kinds they accept, and which hosts serve them.
// UI components must consult this registry instead of scattering format
// rules. Engines live beside it under features/export/; host-only delivery
// (server model endpoints, native transfer, print dialogs) stays with the
// hosts. The `.elef` transfer port remains the separate TransferPort concern
// (P07-03); it is declared here only so capability checks converge.

export const EXPORT_FORMATS = [
  {
    id: "pptx",
    label: "PowerPoint (.pptx)",
    kinds: ["presentation"],
    hosts: ["web"],
    engine: "pptx",
    // The web host serves the JSON model (draft or published release) that
    // the shared engine renders; the generator library loads in the browser.
    model: "web-json",
  },
  {
    id: "print",
    label: "Print",
    kinds: ["presentation", "document"],
    hosts: ["web", "desktop"],
    engine: "print",
  },
  {
    id: "pdf",
    label: "PDF (via print)",
    kinds: ["presentation", "document"],
    hosts: ["web", "desktop"],
    engine: "print",
    via: "print",
  },
  {
    id: "elef",
    label: "Elef transfer (.elef)",
    kinds: ["presentation", "document"],
    hosts: ["desktop"],
    engine: "transfer",
    // Native transfer; orchestration belongs to TransferPort, not this feature.
    via: "TransferPort",
  },
]

export function exportFormatsFor({ kind, host } = {}) {
  return EXPORT_FORMATS.filter(
    (format) =>
      (!kind || format.kinds.includes(kind)) && (!host || format.hosts.includes(host))
  )
}

export function exportFormatById(id) {
  return EXPORT_FORMATS.find((format) => format.id === id) ?? null
}
