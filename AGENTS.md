# Repository Instructions

- Elef is a Rails monolith for authoring and presenting Markdown slide decks;
  raw Markdown is canonical.
- Prefer Rails views with Hotwire/Stimulus. Cover parsing/rendering with unit
  tests, Rails boundaries with request tests, and complete workflows with
  headless Selenium system tests. Run the smallest relevant test first.
- Assume the existing development server is
  `https://127.0.0.1:3000/`. Reuse it; never start a second server or change
  ports. Restart only for boot-time changes that cannot reload safely
  (environment/application config, initializers, dependencies, or asset
  configuration). Verify the endpoint before and after a required restart.
- The primary checkout belongs to the user's main agent. Never create a
  worktree, branch, or container implicitly. The user explicitly starts an
  isolated task with `scripts/elef-agent start TASK`, then launches Codex with
  `scripts/elef-agent codex TASK`. `start` prepares and starts Rails in the
  task container; use `scripts/elef-agent up TASK` to restore a stopped task.
- Treat `up`, `stop`, `remove`, and `cleanup` as state-changing operations.
  Before using them on an existing task, determine whether the container is
  active and tell the user if the operation will interrupt a Codex session;
  do not interpret a failed container-CLI/status check as proof that a task is
  stopped. Ask for confirmation before recreating an active container.
- Each task's Codex home and session history must remain host-persistent under
  the Elef agent state directory. Recreating a container is acceptable only
  when that persistent state is mounted back into `/home/developer/.codex`;
  preserve the task worktree and verify the task URL before and after the
  recreation. Afterward, use `scripts/elef-agent resume TASK` when a prior
  session exists.
- For isolated agent browser checks, run `scripts/elef-agent setup` once and
  use the task URL printed by `scripts/elef-agent start TASK`,
  `https://TASK.localhost`. These URLs are routed to the matching container;
  do not point browser checks at the main checkout's server.
- Claims must match direct evidence. State exactly what was tested and
  what it verifies; do not infer untested specifics from broader results.
- Never claim a fix works unless the relevant behavior was personally re-
  tested after the fix.
- All browser automation must remain headless; never open a visible browser.
- Commit coherent changes frequently with concise imperative subjects (ideally
  under 50 characters). Do not add co-author trailers, amend, rewrite history,
  or revert unrelated user changes.
