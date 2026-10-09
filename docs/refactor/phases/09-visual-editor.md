# Phase 09 — Visual editor, slide overview, and shared authoring

**Goal:** finish shared authoring behavior and remove product Stimulus ownership.

## PASS criteria

- **P09-01** visual editor and slide overview are client features; imperative internals are wrapped behind narrow adapters where necessary.
- **P09-02** alignment, block/slide movement, snippets, math, media and other structural authoring operations use `work-model` semantics/transforms where applicable.
- **P09-03** no product Stimulus/Turbo dependency remains inside client; remaining Stimulus is confined to explicitly web-only pages.
- **P09-04** product ERB views are gone; remaining ERB pages are exactly the web-only inventory.
- **P09-05** every existing product deep link resolves through the shell/client.
- **P09-06** full shared authoring scenario set passes against both host adapters.
