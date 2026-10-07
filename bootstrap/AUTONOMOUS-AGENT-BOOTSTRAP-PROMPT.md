# Elef Autonomous Agent-System Bootstrap Prompt — v9

You are bootstrapping and then operating Elef's repository-native autonomous engineering system.

Your job is **not** to create documentation and stop. Install the smallest durable Agent Skills + root `AGENTS.md` needed for a fresh capable coding agent to enter this repository, receive only:

> go

and safely resume the v9 Elef refactor from whatever verified phase it is in, continuing phase after phase until final technical PASS or a constitution-defined blocker/human gate.

The normal execution environment is a Linux container with approximately 8 GB RAM. Treat resource limits as an execution constraint, not as a reason to weaken the target architecture or tests.

## A. Authority

Locate the v9 campaign material supplied under `docs/refactor/`.

Authority is:

1. durable product/architecture truth identified by `docs/refactor/CONSTITUTION.md`;
2. campaign-wide temporary rules → `docs/refactor/CONSTITUTION.md`;
3. active phase truth → `docs/refactor/phases/NN-*.md`;
4. resumable machine state → `docs/refactor/status.json`;
5. workflow instructions → `.agents/skills/`;
6. concise routing/safety policy → root `AGENTS.md`;
7. executable evidence → `bin/check`, tests, CI and repository tooling.

Skills teach **how to work**. They must not copy architecture/phase truth.

If older constitutions, migration plans, skills or agent instructions conflict with v9, reconcile or retire them explicitly. Do not leave two live sources of truth.

## B. Install exactly the core workflow skills

Create repo-local skills at:

`.agents/skills/<skill-name>/SKILL.md`

Use valid front matter (`name`, concise `description`) and progressive disclosure. Supporting detail may live under each skill's `references/`; deterministic helpers may live under `scripts/`.

Use these five core skills unless actual repository constraints prove two should be combined. Any deviation must be justified in the bootstrap report.

### 1. `elef-campaign`

Trigger for: `go`, continue, resume, finish the refactor, run the campaign.

Responsibilities:

- validate git/worktree safety;
- validate/reconstruct `docs/refactor/status.json`;
- determine the earliest phase whose PASS is actually proven;
- load only `AGENTS.md`, the core constitution, status, current phase contract, frozen plan and relevant diff initially;
- PLAN → DO → CHECK → ACT;
- invoke strategy when a phase is not frozen or reality invalidates it;
- use cheap checks during iteration;
- invoke independent fresh-context review at phase gate;
- fix/replan/re-review until PASS or defined BLOCKED;
- write exact phase PASS evidence/status;
- checkpoint commit;
- advance automatically to the next phase;
- survive complete context reset from repository state alone;
- continue through final technical PASS without asking "should I continue?".

### 2. `implementation-strategy`

Trigger before each new campaign phase and before nontrivial architecture/runtime/product changes.

It must classify semantic ownership using the constitution (`spec`, `contracts`, `work-model`, `renderer`, `client`, host adapter, `local-store`, ops/tooling), distinguish shared vs host-specific behavior, apply package-admission/minimization rules, name behavior to preserve, deletions, rollback triggers and proof commands, and freeze the phase execution contract where required.

It may not invent packages merely because a feature is large.

### 3. `code-change-verification`

Trigger after code/build/test behavior changes.

Inspect the diff and choose the cheapest sound tier:

`quick → affected → phase → all`

Use warm-cache fast-path budgets from the constitution. Do not run full Rails + Tauri/release validation on each small edit.

On the 8 GB container:

- serialize unrelated heavyweight jobs by default;
- start with conservative workers;
- preserve safe build/dependency caches;
- treat OOM/resource kills as infrastructure evidence, reduce concurrency and rerun before classifying product failure;
- never weaken checks to fit memory;
- never claim an unavailable real-native check passed.

### 4. `independent-phase-review`

Trigger only when a phase claims readiness for PASS.

Use a genuinely fresh context via native subagent/worker, isolated agent session/process, or clean noninteractive agent process/worktree. Fresh does not mean simultaneous: release implementation resources first.

Give reviewer only: constitution, active phase, status, frozen plan, base/head SHAs, diff, repository at candidate HEAD, and machine evidence/permission for read-only checks.

Do not give implementer reasoning.

Return `PASS | FAIL | BLOCKED(reason)` with reproducible evidence per criterion and permanent invariant.

If the environment cannot create a genuine fresh reviewer, record `BLOCKED(reviewer-unavailable)`. Never self-certify.

### 5. `docs-sync`

Trigger when durable architecture/developer knowledge or campaign state changes, and at final cleanup.

Keep durable docs, temporary campaign docs and code consistent. Never create duplicate truth. At final campaign completion, support the requirement that `docs/refactor/` can be deleted without losing maintainability knowledge.

## C. Root `AGENTS.md`

Create/rewrite root `AGENTS.md`, preserving still-valid repo-specific instructions and removing stale contradictions.

Keep it roughly 60–120 lines.

It is a router/policy file, not a second constitution.

Near the top include explicit skill triggers:

- `go` / resume / finish campaign → `$elef-campaign`
- new phase or nontrivial architecture/runtime change → `$implementation-strategy`
- code/build/test behavior changed → `$code-change-verification`
- candidate phase PASS → `$independent-phase-review`
- durable docs/status changed → `$docs-sync`

State that Elef is one product in Rails/Tauri hosts and point to durable docs/constitution rather than restating them.

Authorize agents to inspect/edit campaign scope, run deterministic local checks, fix their failures, create checkpoint commits/worktrees, and advance phases automatically.

Safety prohibitions:

- do not discard unknown user changes;
- do not reset unrelated work;
- do not weaken tests/criteria/baselines to pass;
- do not silently alter a frozen phase contract;
- do not grow architecture allowlists merely to pass;
- do not invent credentials;
- do not claim unrun/unavailable tests passed;
- do not merge campaign to `dev` or perform human-only release gates.

## D. State/resume

`docs/refactor/status.json` is the machine resume source.

If absent/stale/inconsistent:

1. inspect git history, exact phase PASS markers, review reports, phase contracts and actual repository state;
2. identify the earliest phase whose completion cannot be proven;
3. resume there;
4. do not infer completion from file presence;
5. record reconstruction evidence.

Populate the constitution's execution-environment fields from the actual container.

A fresh agent must be able to resume with no chat history.

## E. Branch safety

Use the v9 campaign branch/lineage rules from the constitution.

Never overwrite unknown local changes or silently choose between conflicting histories.

If the active branch exists in another worktree, use a safe worktree workflow. If lineage cannot be proven, use the constitution's blocker state.

## F. Resource-constrained execution

Probe RAM, swap, CPU, disk, architecture, display/headless support, Tauri/webview prerequisites and toolchains before relying on environment-sensitive checks.

The normal machine is approximately 8 GB RAM:

- do not keep multiple browser stacks, Rust builds, Rails servers and reviewer workloads alive unnecessarily;
- serialize heavyweight groups by default;
- preserve caches;
- make `quick`/`affected` the ordinary edit loop;
- distinguish cold bootstrap/install time from warm feedback;
- macOS-only/signing/owner-device behavior is not provable here;
- run real Linux Tauri scenarios when prerequisites exist; otherwise record the native runner as unavailable rather than substituting a mock PASS.

## G. Bootstrap validation

Do not assume the agent system works because files exist.

Validate:

1. every skill manifest/path;
2. every `AGENTS.md` skill trigger resolves;
3. skills do not duplicate normative architecture/phase criteria;
4. normal campaign startup loads only core + current phase, not every phase;
5. status validation/reconstruction works on a disposable fixture/copy;
6. resource probe is recorded;
7. a fresh-context acceptance agent given only `go` selects `$elef-campaign`, finds the current phase, loads the correct contract and states/performs the correct next action without this bootstrap prompt.

If possible, perform #7 with a fresh subagent.

Commit bootstrap/agent-system changes separately before substantial product work.

## H. Then actually continue the campaign

Do **not** stop after bootstrap.

Invoke `$elef-campaign`.

For every phase:

PLAN → frozen plan  
DO → implementation  
CHECK → quick/affected during iteration, phase gate when ready  
REVIEW → fresh-context independent reviewer  
ACT → fix/replan/block/pass  
PASS → exact machine marker + review PASS + status update + checkpoint commit → next phase

Do not ask the owner to approve routine phase transitions.

Continue until every v9 technical phase is PASS and final full validation/architecture cleanup succeeds, or a constitution-defined blocker/human gate makes further autonomous work impossible.

At final handoff report only:

- final campaign state;
- final HEAD;
- completed phases;
- verification evidence;
- pending human-only release gates;
- unresolved blocker if any;
- final PR/handoff location.

Begin now by inspecting the repository, installing/reconciling the smallest valid agent system, validating it, and then continuing the campaign.
