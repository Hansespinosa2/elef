---
title: 'Reliable optimized agent container lifecycle'
type: 'feature'
created: '2026-09-03'
status: 'done'
baseline_commit: '436cbb043813dd3a7fd8e7e9c684cc1b17ab70a1'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `scripts/elef-agent start TASK` creates a routed container but leaves it running `sleep infinity`, so the advertised task URL has no Rails server behind it. Repeated starts also invoke a full image build and can allow globally installed tooling to drift between environments.

**Approach:** Make the launcher own the task web process and lifecycle. Start Rails/Puma on container port 3000 with a container-safe bind address, verify the routed HTTPS endpoint in two stages, and reuse immutable fingerprinted images whose tooling versions are pinned.

## Boundaries & Constraints

**Always:** Preserve task-specific worktrees, branches, host ports, Caddy HTTPS URLs, direct Rails/Puma development behavior, and existing GitHub/Codex mounts. Keep `bundle install` and `db:prepare` before serving. Use `Gemfile.lock` for Ruby dependency consistency.

**Ask First:** None; the lifecycle and launcher choices were elicited and approved in conversation.

**Never:** Do not start a second host Rails server, use Foreman as the managed process, share mutable Bundler state between tasks, silently recreate existing worktrees, or change application code to solve launcher concerns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|-----------------------------|----------------|
| NEW_TASK | No task worktree; image fingerprint absent | Build image, create container, prepare task, start Rails, register route | Cleanly report and remove partial route/container state on setup failure |
| CACHED_TASK | Same image inputs as an existing image | Reuse the exact image without rebuilding stable layers | Build only if the fingerprinted image is unavailable |
| STOPPED_TASK | Existing worktree/container stopped | `up TASK` starts the existing task and restores its route/server | Never create a branch or worktree again |
| REACHABLE_5XX | Routed HTTPS responds with HTTP 500 | Report server/routing reachable and application unhealthy | Do not misdiagnose transport as startup failure |
| UNREACHABLE | Rails exits, wrong bind, or timeout | Startup fails with actionable diagnostics and no stale route | Preserve worktree for inspection; remove only transient runtime state |

</frozen-after-approval>

## Code Map

- `scripts/elef-agent` -- task creation, image build invocation, container lifecycle, Caddy route registration, status, stop, and command dispatch.
- `.devcontainer/Containerfile` -- stable Ruby/Debian development image, globally installed tools, and build-time version inputs.
- `.devcontainer/entrypoint.sh` -- container initialization and the process contract for the managed web service.
- `Procfile.dev` and `bin/dev` -- existing developer convention; confirms the app currently has only a web process and does not require Foreman for launcher-managed serving.
- `config/puma.rb` -- Rails/Puma port configuration via `PORT`, with port 3000 as the container default.
- `Gemfile.lock` -- locked Ruby dependency versions used by per-task `bundle install`.

## Tasks & Acceptance

**Execution:**
- [x] Update `.devcontainer/Containerfile` -- pin globally installed tool versions and expose stable image inputs -- prevent rebuild-to-rebuild drift.
- [x] Update `.devcontainer/entrypoint.sh` -- support the managed Rails/Puma process contract -- keep the container web process observable and correctly bound.
- [x] Update `scripts/elef-agent` -- fingerprint/reuse images, launch Rails after preparation, add `up`, and improve status/cleanup failure handling -- make task URLs usable and lifecycle operations repeatable.
- [x] Add launcher-focused tests or deterministic shell checks -- cover image reuse, bind/port arguments, readiness states, and stopped-task restoration -- prevent regressions in the orchestration boundary.

**Acceptance Criteria:**
- Given a new task, when `start TASK` completes successfully, then `https://TASK.localhost` reaches Rails through Caddy and Rails listens on container port 3000.
- Given unchanged image inputs, when a second task starts, then it uses the existing fingerprinted image without rebuilding it.
- Given a stopped existing task, when `up TASK` runs, then its original worktree, branch, image, host port, and URL are reused.
- Given a reachable homepage returning 5xx, when readiness completes, then output distinguishes server reachability from application health.
- Given Rails cannot bind or boot, when readiness times out, then the command fails with diagnostics and does not leave a misleading active route.

## Spec Change Log

## Design Notes

The external URL is HTTPS only at Caddy; the Rails process speaks HTTP inside the container and must bind `0.0.0.0`, not its default loopback address. Each task keeps its own Bundler installation/state while sharing only the immutable OS/tool image.

## Verification

**Commands:**
- `bash -n scripts/elef-agent .devcontainer/entrypoint.sh` -- expected: no shell syntax errors.
- Launcher-focused tests/checks -- expected: lifecycle and readiness scenarios pass without changing application behavior.

## Suggested Review Order

**Task lifecycle and readiness**

- The launcher now owns image selection, container startup, routing, and readiness.
  [`scripts/elef-agent:24`](../../scripts/elef-agent#L24)

- Rails binds externally through the container while Caddy remains HTTPS-only.
  [`scripts/elef-agent:214`](../../scripts/elef-agent#L214)

- Existing tasks can be restored without recreating their worktrees or branches.
  [`scripts/elef-agent:282`](../../scripts/elef-agent#L282)

**Container environment**

- The image pins its base and globally installed developer tooling versions.
  [`Containerfile:1`](../../.devcontainer/Containerfile#L1)

- The entrypoint prepares the branch before replacing itself with Rails/Puma.
  [`entrypoint.sh:13`](../../.devcontainer/entrypoint.sh#L13)

**Verification and documentation**

- Static launcher checks protect the process and image contracts.
  [`elef-agent_test.sh:17`](../../test/scripts/elef-agent_test.sh#L17)

- Usage documentation describes automatic Rails startup and task restoration.
  [`README.md:43`](../../README.md#L43)

</spec>
