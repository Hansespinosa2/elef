# Elef Agent Instructions

Elef is a Markdown authoring and presentation app with a Rails web host and a Tauri desktop host. Shared behavior is implemented once and mounted by both hosts.

## Start here

1. [ELEF-DOCTRINE.md](ELEF-DOCTRINE.md) — product principles and owner intent.
2. [docs/architecture.md](docs/architecture.md) — boundaries, ownership, contracts, change routing.
3. [docs/development.md](docs/development.md) — setup, check tiers, feature/bug workflow.

Each fact has exactly one home; link to it instead of copying it.

## Verify with bin/check

- `bin/check quick` (~20 s) during iteration, `bin/check affected` (~1 min) before handoff, `bin/check all` (~18 min, ceiling 45 min) for release-scale changes.
- Rails suites need ambient `PGPASSWORD`; browser suites need /tmp headroom and run one at a time; keep browsers headless.
- Report the exact tier actually exercised; never claim unrun or unavailable checks passed.

## Safety

- Never touch the owner's `https://127.0.0.1:3000/` server (diagnose read-only only), and never point tests at personal, live, or production data.
- Never merge into `dev`, publish a release, alter signing keys, or invent/commit credentials.
- Never weaken tests, checks, baselines, or fixtures to obtain green, and never silently change a frozen contract.

## Changes

- Route by ownership: shared behavior in `packages/*`, web-only in `apps/web`, native-only in `apps/desktop`; add a host adapter only when a concrete platform capability differs.
- Read the relevant code and tests before changing anything; make the smallest fix at the root cause.
- Leave the tree clean and green before handoff; commit with imperative subjects and no history rewriting.
