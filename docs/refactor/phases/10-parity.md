# Phase 10 — Full product parity and change-locality proof

**Goal:** prove the two real hosts are hosts of one product rather than parallel implementations.

## PASS criteria

- **P10-01** shared scenario definitions cover library, create/open/rename/delete, source/visual editing, preview, presentation, graph, authoring, media, settings, save/conflict/recovery and supported export behavior.
- **P10-02** each shared scenario runs against both real host adapters where that capability exists; capability-disabled behavior is asserted explicitly.
- **P10-03** `host-differences` inventory contains only concrete platform/capability differences; no difference is justified by “desktop/web can be different.”
- **P10-04** three seeded unseen change-routing exercises are completed by a fresh agent in ≤5 minutes each: one shared feature, one web-only bug, one desktop/local-store bug. It must name owner and proof commands correctly from durable docs.
- **P10-05** a five-line representative client change completes `quick` and `affected` inside hard ceilings without full host E2E during edit iteration.
- **P10-06** fake host can exercise the client contract suite with no Rails/Tauri process.
