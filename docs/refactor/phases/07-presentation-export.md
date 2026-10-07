# Phase 07 — Presentation and product export

**Goal:** share presentation interaction and keep export a feature/module unless evidence earns a separate package.

## PASS criteria

- **P07-01** presentation navigation, keyboard/fullscreen, editing chrome and stable styling live in client and pass shared scenarios on both hosts.
- **P07-02** renderer contains presentation projection but no presentation editor controls.
- **P07-03** user-facing export orchestration begins under the client export feature with explicit format implementations; `.elef` transfer remains the separate `TransferPort` concern.
- **P07-04** existing PPTX behavior is preserved or deliberately changed only where the phase PLAN names it; its engine is separated from button/status/fetch orchestration enough to unit-test export logic independently.
- **P07-05** no `presentation-export`, `document-export`, `graph`, or generic `export` package is created unless the reviewer proves the package-admission law.
- **P07-06** export feature declares supported Work kinds/formats/capabilities in one registry rather than scattering format rules through UI components.
- **P07-07** stable presentation screenshot/visual checks use a fixed fixture set named in the phase PLAN; reviewer may only judge against those fixtures, not an unbounded aesthetic standard.
