# Phase 05 — Settings and appearance

**Goal:** one shared settings/appearance capability in the client.

## PASS criteria

- **P05-01** product settings/appearance UI and semantic state exist only in client.
- **P05-02** settings round-trip through both adapters using the same contract tests.
- **P05-03** capability-dependent UI such as updater presence branches on `HostCapabilities`, never host name.
- **P05-04** product styles/tokens have one owner; no host-specific duplicate stylesheet implements a shared component.
- **P05-05** shared settings/appearance scenarios pass on both hosts and fake-host unit/integration tests remain green.
