# Phase 11 — Host rehome and deployment continuity

**Goal:** move Rails/Tauri to final host locations without product behavior changes and keep deployment/release functioning.

## PASS criteria

- **P11-01** Rails lives under `apps/web`; Tauri under `apps/desktop`; old host roots are absent except documented temporary compatibility paths with deletion conditions.
- **P11-02** app-local Rails runtime files stay with `apps/web`; environment/machine deployment/provisioning lives under `ops`; generic release logic lives under `tooling/release`.
- **P11-03** all root-layout references discovered in Phase 00 are updated and a throwaway deploy/build dry run succeeds.
- **P11-04** no product behavior change: Phase 10 scenario names/results remain green.
- **P11-05** every CI group executable in the Linux container is green locally, and CI configuration still covers all supported OS tiers. Remote macOS/native results are release evidence when available; absence of that external runner is recorded as a pending human/release gate and is never replaced by a mock PASS.
- **P11-06** owner live Mac mini deployment is human gate H4; if unavailable, phase may be internally CHECK-complete but campaign state records pending H4 and cannot claim release-ready.
