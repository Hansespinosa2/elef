# Elef Refactor Constitution — v9

**Status:** candidate architecture freeze and autonomous migration protocol, reconciled for an 8 GB Linux-container implementation environment.
**Campaign branch:** `feat/refactor-desktop-and-web`.
**Reference branch:** `feat/desktop-app-v1` only as the known pre-refactor implementation reference; it is not the campaign branch.
**Target:** one Elef product, shared by Rails web and standalone Tauri desktop, with platform-neutral behavior implemented once and host-specific behavior confined to host adapters.

This file is intentionally small. It contains only durable decisions, invariant rules, exact cross-layer contracts, and the campaign protocol. Phase-specific success criteria live in `phases/NN-*.md`. The migration is complete only when the durable knowledge has been promoted to the permanent repository docs and `docs/refactor/` can be deleted.

---

## 1. Authority and operating model

Authority, highest first:

1. **Owner product intent and hard constraints in this constitution.**
2. **Architecture and interface decisions in this constitution.**
3. **The active phase contract.**
4. **Durable repository docs and ADRs.**
5. **Current implementation.** Current code is evidence of reality, not authority over the target.

No agent may weaken a higher-level rule to obtain PASS. A contradiction is `BLOCKED(criteria-conflict)` until resolved by the owner or an approved ADR for a later phase.

Every phase follows exactly:

`PLAN → DO → CHECK → ACT`

- **PLAN:** verify relevant current facts; write `docs/refactor/execution/phase-N-plan.md`; freeze scope, target, risks, rollback triggers and validation before production edits. ACT records its SHA-256 in `status.json`; production edits are forbidden until then.
- **DO:** implement the frozen plan only.
- **CHECK:** fresh-context, read-only verification against the frozen phase contract and all permanent invariants.
- **ACT:** classify findings: implementation defect → DO; plan defect → PLAN; architecture/criteria conflict → BLOCKED; human gate → pending/BLOCKED; all green → PASS.

The campaign runs autonomously on one long-lived branch. The owner is not required to merge between phases. Each PASS phase ends in a revertible checkpoint commit. The owner reviews and merges the final campaign PR into `dev`.

### Machine state and resume protocol

`docs/refactor/status.json` is the single campaign-state source of truth:

```json
{
  "campaign_version": 9,
  "campaign_branch": "feat/refactor-desktop-and-web",
  "campaign_base_sha": "<sha>",
  "current_phase": 0,
  "phase_state": "PLAN|DO|CHECK|ACT|PASS|BLOCKED",
  "phase_base_sha": "<sha>",
  "head_sha": "<sha>",
  "review_round": 0,
  "phase_contract_sha256": "<sha256>",
  "frozen_plan_sha256": "<sha256|null>",
  "last_completed_phase": null,
  "last_verified_checks": [],
  "execution_environment": {
    "os": "linux",
    "arch": "<arch>",
    "ram_mb": "<integer>",
    "swap_mb": "<integer>",
    "cpu_count": "<integer>",
    "free_disk_mb": "<integer>",
    "display_mode": "native|headless|none",
    "tauri_native_runner": "available|unavailable|unknown"
  },
  "pending_human_gates": [],
  "blocker": null,
  "next_action": "<single executable next action>"
}
```

A fresh agent resumes by reading, in order: `AGENTS.md`, this file, `status.json`, the current phase contract, then the diff from `phase_base_sha..HEAD`. It does not reconstruct state from chat history.

### Phase PASS marker

`bin/check phase N --json` must exit `0` and emit:

```json
{"phase":N,"result":"PASS","head":"<sha>"}
```

and stdout must contain exactly one line `ELEF_PHASE_N=PASS`.

A phase is not complete until a fresh reviewer also writes `docs/refactor/reviews/phase-N-round-K.md` with `Result: PASS`, and `status.json` is advanced by ACT. Automated checks alone cannot certify subjective architecture criteria; reviewer prose alone cannot substitute for automated criteria.

---

## 2. Product intent and quality bar

1. **One product.** Web and desktop are two hosts of the same Elef product. Platform-neutral behavior has one canonical implementation.
2. **Fix once, inherit everywhere.** A platform-neutral bug fix or feature is implemented at its semantic owner and inherited by both hosts without duplicate host implementations.
3. **Host-specific means genuinely host-specific.** Rails auth/database/deployment stays web-side; native lifecycle/updater/OS integration stays desktop-side; local filesystem persistence stays in the local persistence engine.
4. **Desktop remains standalone and offline.** No Rails/Ruby/network dependency is required for normal desktop use. Accounts, subscription, cloud sync and real-time collaboration are web capabilities unless the owner changes this rule.
5. **Markdown source is canonical for an Elef Work.** A Work is `document | presentation`; derived projections are never storage truth.
6. **Data safety outranks convenience.** Atomic writes, recoverability, no silent stale overwrite, and preservation of the losing side of conflicts are non-negotiable.
7. **Ordinary changes are cheap.** Small shared changes must not require a 30-minute feedback loop. Validation cost is proportional to risk.
8. **Agent-executability is a maintainability requirement.** An unfamiliar agent must be able to answer “where does this change belong?” and “what proves it works?” from repository files in under five minutes.
9. **Behavior-preserving migration.** Refactor phases do not change product behavior unless the phase contract explicitly names the intended behavior change.
10. **Long-term clarity over smallest diff, but no speculative architecture.** Choose durable boundaries when justified; do not pre-build future subsystems.

---

## 3. Design doctrine

These are decision rules, not additional layers of authority.

- **SSOT:** one authoritative owner for each piece of knowledge. Multiple representations are allowed only when generated/validated against that authority.
- **DRY:** deduplicate knowledge and policy, not merely similar text. Similar host code may stay separate when it represents different host responsibilities.
- **KISS:** every package, abstraction, tool, document and test framework spends cognitive complexity. Prefer the valid design with fewer concepts.
- **Deep modules / information hiding:** a boundary should hide materially more complexity than it exposes. Shallow wrappers are rejected.
- **Different layer, different abstraction:** do not create layers merely because calls occur in sequence.
- **YAGNI:** preserve future options with small seams and capabilities; do not build speculative systems.
- **Local reasoning:** a feature should be understandable and testable without loading unrelated hosts into context.
- **Machine-enforce important boundaries:** dependency direction, forbidden imports, artifact freshness and architecture ratchets belong in checks, not conventions alone.
- **Deletion pressure:** if an abstraction can be removed without reintroducing a concrete problem, it has not earned permanence.

### Package admission law

A directory becomes a separately versioned/buildable package only when **all** are true:

1. one cohesive semantic responsibility;
2. a small stable public API;
3. acyclic, machine-enforceable dependency direction;
4. meaningful independent tests;
5. a concrete architectural payoff;
6. it hides substantially more complexity than it exposes (except the intentionally interface-centric `contracts` package).

And at least one concrete driver exists: multiple architectural consumers, multiple runtimes, domain-kernel isolation, material dependency/security/runtime isolation, or a separate language/toolchain.

Code size, importance, symmetry, possible future reuse, or folder tidiness are not sufficient. If a capability does not pass this test, it remains a module/feature inside its semantic owner. Package count is minimized.

---

## 4. Normative target boundaries

```text
elef/
├── apps/
│   ├── web/                       # Rails host
│   └── desktop/                   # Tauri host
├── packages/
│   ├── contracts/                 # host/client ports and cross-boundary types
│   ├── work-model/                # pure semantics/transforms of Elef Works
│   ├── renderer/                  # pure deterministic projection
│   └── client/                    # complete host-neutral interactive application
├── crates/
│   └── local-store/               # Tauri-independent local persistence engine
├── spec/                          # persisted format, schemas, compatibility, fixtures
├── tests/                         # cross-boundary/integration/parity scenarios
├── tooling/                       # architecture/build/test/release/CI tooling
├── ops/                           # environment/machine operations, not app logic
├── docs/                          # durable docs; `docs/refactor/` is temporary
├── bin/                           # repo-level developer/verification commands
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
└── Cargo.toml
```

Only these architectural boundaries are frozen. Internal feature folders are not architecture and may evolve under the rules above.

### Ownership

- **`spec/`** — persisted Elef format, schema/version rules, archive layout, compatibility/migration fixtures. Declarative truth only.
- **`contracts/`** — operations and cross-boundary types between the shared client and hosts; capabilities; `WorkSession`; error/result shapes. No host implementations.
- **`work-model/`** — pure semantics of an Elef Work (`document | presentation`): parsing, front matter, directives, structural source ranges, links, and pure source transforms. No DOM, React, filesystem, network, Rails or Tauri.
- **`renderer/`** — deterministic safe projection of a Work/model to render output. No interactive controls, persistence, navigation, dialogs, React, Rails or Tauri.
- **`client/`** — the complete host-neutral interactive application: application state, navigation, feature workflows, editor integration, session coordination, React views, styling and user intent. It reaches environments only through contracts.
- **`local-store/`** — local library/deck discovery, atomic saves, snapshots, watch/merge/recovery, assets, archives and path safety. No Tauri/window/webview knowledge.
- **`apps/web/`** — Rails shell/routes, ActiveRecord/database, auth/session, jobs/mail, HTTP contract adapter, web-only pages and app-local runtime config.
- **`apps/desktop/`** — Tauri bootstrap, IPC adapter, lifecycle, updater, menus/dialogs and native integration. Persistence algorithms stay in `local-store`.
- **`ops/`** — environment-specific deployment/provisioning/watchers such as Mac mini operations.

### Dependency direction

`spec` is data, not executable dependency glue.

```text
work-model  ← renderer
     ↑          ↑
     └──── client ───→ contracts ← host adapters
                               \
                                desktop adapter → local-store
```

Allowed dependencies:

- `contracts`: schema data only; depends on no executable Elef package.
- `work-model`: schema/spec data and narrowly justified parsing libraries; not renderer/client/hosts/local-store.
- `renderer`: `work-model`, contract types where necessary; not client/hosts/local-store/DOM.
- `client`: `work-model`, `renderer`, `contracts`; not Rails/Tauri/local-store/filesystem/ActiveRecord.
- `local-store`: `spec` fixtures/schemas as data; not Tauri or JS packages.
- hosts depend inward on contracts/client artifacts and their host implementation dependencies; hosts never depend on each other.

No deep imports across package internals. Public entry points only.

### Client internal rule

`client` is one architectural package, not a god-module. Internally it separates:

- `application/` — composition, navigation, cross-feature orchestration;
- `features/` — cohesive vertical product capabilities;
- `session/` — editing/session lifecycle;
- `ui/` — reusable visual primitives, styles and the sole raw-render insertion boundary.

Feature modules do not deep-import each other and do not form cycles. Cross-feature coordination belongs in `application/` or in a truthful shared owner.

### Export and graph

Export and graph are **not packages by default**.

- semantic Work-link parsing/resolution belongs to `work-model`;
- graph layout/visual interaction belongs to `client/features/graph`;
- product export UX/orchestration and format implementations begin under `client/features/export` and may be lazy-loaded;
- `.elef` import/export is a format/persistence transfer concern, distinct from user-facing PDF/PPTX/DOCX/Markdown export.

A future exporter/graph engine may graduate to a package only by the package-admission law.

---

## 5. Cross-boundary contract law

The public host/client contract is frozen in Phase 01 before behavior migration. It uses Elef domain names (`Work`, not “document” as a synonym for both documents and presentations) and includes: branded workspace/work/media/request IDs; the fixed error taxonomy; `HostCapabilities`; baseline/snapshot/save results; `WorkSession`; and `ElefHost` ports for library, works, media, settings, search and `.elef` transfer.

`mountElef(hostElement, host, options?)` is the sole host entry point. `WorkSession` is the sole editing/save lifecycle seam. Rails, Tauri and fake-host implementations must pass one conformance suite. New port operations are admitted only when existing shared-client behavior cannot be expressed without them and all three adapters gain the same conformance test.

Client code branches on capability, never host name or plan name. State ownership is singular: Work semantics → work-model; projection → renderer; cursor/undo → editor; navigation → client application; save lifecycle → WorkSession; web persistence → web/database; local persistence/history → local-store/filesystem; auth → web; native lifecycle/updater → desktop.

---


## 6. Build, renderer and performance decisions

- React + TypeScript is fixed for `client`. No automatic Preact fallback. A framework change requires owner-approved ADR.
- TypeScript strict, ESM, Node 22, esbuild, one root npm lockfile; one root Cargo workspace.
- canonical generated JS/CSS artifacts live once in the producing package `dist/`; host packaging consumes them. No committed duplicate host copies.
- freshness check rebuilds into temp and compares canonical `dist/` artifacts; verification leaves the checkout unchanged.
- renderer must be deterministic and DOM-free and pass the same fixture suite in **Node 22**, a **Chromium browser context**, and the **real Tauri webview path**. If Rails still executes renderer server-side, that actual Rails JS engine is an additional required smoke target until the path is removed.
- rendered HTML reaches the DOM through one client security boundary (`SafeHtml` or equivalent); hostile-document fixtures cover script/event/javascript-URL/malformed cases.

### Execution environment and validation-time budgets

The normal autonomous implementation environment is a **Linux container with approximately 8 GB RAM**. Phase 00 records the actual CPU count, RAM, swap, free disk, architecture, display/headless-display support, Tauri/webview prerequisites, and required toolchains before using environment-dependent checks.

Resource policy:

- correctness is preferred over maximum parallelism;
- unrelated heavyweight jobs are serialized by default;
- Cargo/test/browser worker counts start conservatively and may increase only after measured headroom;
- npm/Cargo/browser caches are preserved when doing so does not compromise reproducibility;
- the implementer releases heavyweight processes before launching the independent reviewer;
- temporary review worktrees are used sequentially rather than kept fully built in parallel;
- an OOM/resource kill is infrastructure evidence, not automatically a product failure: reduce concurrency, isolate and rerun before classification;
- required checks are never weakened or silently skipped merely to fit the machine.

The Linux container proves shared/Linux correctness only. It cannot prove macOS signing/notarization, Apple-only native behavior, first-install behavior on the owner Mac, or owner-device performance. Those remain explicit human/release gates. Real Linux Tauri scenarios run when the container has the required webview/display prerequisites; if it does not, lower-layer/shared work continues and the unavailable native runner is recorded rather than mocked into PASS.

Fast-feedback budgets are measured **warm** after dependency installation and an initial build/cache population; first-time dependency downloads and a clean bootstrap compile are recorded separately and do not redefine ordinary edit-loop cost:

- `bin/check quick`: target ≤120 s, hard ceiling 180 s;
- `bin/check affected`: target ≤300 s, hard ceiling 420 s.

Phase/full validation may be serialized on the 8 GB container. Therefore their local wall-clock time is diagnostic rather than a product-performance verdict. The repository CI/reference environment retains:

- `bin/check phase N`: target ≤15 min excluding explicitly named native/human gates;
- `bin/check all`: CI ceiling 45 min.

If warm `quick`/`affected` cannot meet their hard ceilings, the agent must first improve selection, caching or test architecture; it may not simply broaden the budget. An owner-approved exception must name evidence, scope and expiration.

### Product-performance policy

Machine speed and product speed are separate concerns. Phase 0 records current medians for named user-visible product probes on the best available comparable runner and identifies which probes require real target hardware. Until a later owner-approved budget replaces them, each probe has both: (a) no more than 10% regression from the locked comparable baseline median, and (b) no regression that crosses an existing repository hard ceiling. A slow container is not evidence that a user-facing latency regression is acceptable, and container build duration is not itself a user-facing latency metric. New user-visible operations added later must define a budget with the feature.

---

## 7. Validation doctrine

Validation is risk-based:

- **quick:** changed-package unit/static/architecture checks;
- **affected:** all tests selected by dependency/ownership impact plus shared scenario definitions relevant to the change;
- **phase:** phase contract + all permanent invariants + required integration runners;
- **all:** full release/integration envelope.

Pure shared logic is tested once at its canonical owner. Shared user behavior is specified once and may be executed against both host adapters at affected/phase/release gates. “Test once” never means “never exercise the real hosts.”

Permanent invariants:

1. dependency rules hold and architecture allowlists never grow;
2. no duplicate platform-neutral product implementation across hosts;
3. work semantics have one executable owner;
4. renderer is deterministic/pure and contains no interactive product controls;
5. client has no Rails/Tauri/filesystem/ActiveRecord knowledge and no host-name branching;
6. data-safety rules remain green;
7. desktop runs offline without Rails/Ruby;
8. canonical generated artifacts are fresh; no synchronized committed host copies;
9. docs and status describe reality;
10. protected performance budgets hold;
11. raw renderer HTML enters DOM only through the single security boundary;
12. no generic `shared/`, `common/`, `core/` or `utils/` dumping ground at architectural boundaries;
13. every temporary compatibility path has owner, reason, and deletion condition;
14. tests/checks/thresholds/baselines cannot be weakened in the same change that claims PASS unless the phase contract explicitly replaces them with stronger/equivalent evidence;
15. `bin/check all` run twice on clean checkout gives the same verdict and leaves no diff;
16. package-admission/minimization law holds; every production package has a written one-sentence justification;
17. client feature modules do not form import cycles or hidden cross-feature deep imports;
18. a fresh agent can route unseen changes and identify proof commands from durable repo docs in ≤5 minutes.

---

## 8. Reviewer and orchestration mechanics

The campaign agent is the orchestrator/implementer. At `CHECK_READY` it must first stop/release unnecessary Rails, browser, Rust-build and other heavyweight implementation processes, then launch a **fresh-context reviewer** using the harness's subagent/session/process mechanism. Fresh context is required; simultaneous execution is not. The reviewer receives only:

- this constitution;
- active phase file;
- `status.json`;
- phase base SHA and HEAD SHA;
- diff;
- repository at HEAD;
- CI/check outputs or permission to rerun read-only checks.

It does not receive the implementer's reasoning narrative.

If the harness cannot create a genuinely fresh review context, the campaign becomes `BLOCKED(reviewer-unavailable)` rather than silently self-certifying.

Reviewer output table:

`Criterion | PASS/FAIL/BLOCKED | exact evidence | finding | required fix`

plus permanent invariants, human gates, verified/not-verified and final `Result:`.

Loop caps: maximum 10 review rounds; same finding failing 3 consecutive rounds → `BLOCKED(repeat-finding)`.

Exactly five human gate classes exist:

1. production signing/updater keys and offline backups;
2. first-install acceptance on owner Mac;
3. first-install acceptance on owner Linux/Omarchy device;
4. owner-verified live Mac mini web deployment after host rehome;
5. required real-use soak and explicit acceptance of any documented residual release risk.

Owner merge is not a phase gate; it happens after final campaign PASS.

---

## 9. Documentation and steady-state developer experience

Durable general documentation is intentionally minimal:

- `ELEF-DOCTRINE.md` — product principles and owner intent;
- `docs/architecture.md` — boundaries, ownership, contracts, change-routing examples;
- `docs/development.md` — local setup, validation tiers, feature/bug workflow;
- specialized runbooks only when a domain genuinely needs one (`docs/desktop/*`, deployment, media/printing, etc.);
- `AGENTS.md` — short router to the files above and commands below.

The migration-specific constitution, phase contracts, status and review reports live under `docs/refactor/` and are temporary. Final cleanup cannot PASS until all durable knowledge has been promoted and `docs/refactor/` can be deleted without losing information needed to maintain Elef.

After the refactor, every feature/bug uses the same small cycle:

1. classify semantic owner;
2. implement once at that owner;
3. run `bin/check quick`, then `affected`;
4. run host integration only when the impact map says it is required;
5. update durable docs only when an enduring rule/contract changed.

---

## 10. Campaign bootstrap — embedded kickoff instruction

An orchestrator given this repository must execute the following without a companion prompt:

1. Verify the working tree is clean enough to proceed and inspect branch availability.
2. Use `feat/refactor-desktop-and-web` as the campaign branch. If absent, create it from `feat/desktop-app-v1` **only if** that reference branch exists and the intended ancestry can be verified; otherwise `BLOCKED(branch-base-unclear)`.
3. Probe the actual Linux-container resources/toolchains/native-runner capability and create/verify `docs/refactor/status.json` using the schema in §1; set the actual base SHA and environment fields.
4. Read `AGENTS.md`, this constitution and `phases/00-baseline.md`.
5. Execute phases in numeric order. Do not skip a phase because later work appears easier.
6. For each phase: freeze PLAN artifact; implement; run required checks; spawn fresh reviewer; ACT on findings until PASS or defined BLOCKED state; create a checkpoint commit; update status; continue.
7. Do not merge to `dev`, publish a production release, alter signing keys or silently accept residual data-safety risk.
8. Continue autonomously until the final phase is PASS or a defined blocker/human gate prevents progress.

