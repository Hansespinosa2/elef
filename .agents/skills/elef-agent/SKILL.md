---
name: elef-agent
description: Use Elef's disposable Apple Container workflow for repository implementation tasks that should run in an isolated Codex worktree.
---

# Elef disposable agent workflow

Use this skill when the user explicitly chooses to run an Elef task in an
isolated worktree and Apple Container. The primary checkout belongs to the
user's main agent. Never create a worktree, branch, or container implicitly.

The user owns the split/merge boundary. A task worktree is a real host Git
worktree mounted into its container; it is not a second copy inside the
container. Edits made by Codex are immediately present in that task worktree.

Run commands from the Elef repository root.

## User-controlled task lifecycle

The user starts isolation explicitly:

```sh
scripts/elef-agent start TASK
```

The command creates the branch, worktree, and persistent container, then
launches Codex once Rails is ready. An agent may use `shell`,
`resume`, or other task commands only after the user has created the task.

Use `scripts/elef-agent start TASK BASE` when the task must branch from a
specific commit or branch. The task branch is `codex/TASK` and the worktree is
the sibling directory `../elef-worktrees/TASK`.

New tasks use the latest Codex CLI when their image is built. Existing tasks
retain the image they were created with, including when they are resumed with
`up`; use an intentional image refresh when upgrading an existing task.

Codex is launched in the container with approvals and sandbox bypassed and
model `gpt-6-luna`, with maximum reasoning for implementation and plan mode.
Treat the container as the isolation boundary, but
remember that the mounted task worktree and shared Git metadata are host files.

## Continue and inspect

```sh
scripts/elef-agent resume TASK
scripts/elef-agent shell TASK
scripts/elef-agent shell TASK bin/rails test
scripts/elef-agent codex TASK
scripts/elef-agent fork TASK
```

Keep browser automation headless. Use the installed Chromium and Chrome
DevTools MCP for browser checks. Run the smallest relevant tests first.

## Merge and cleanup

The primary agent reviews task PRs. Do not merge or tear down a task without
an explicit user request. When a task branch has an open PR, that PR is the
merge boundary: if the user asks to merge the task branch into a target
branch, inspect and merge the PR through GitHub, then confirm its state is
`MERGED`:

```sh
gh pr view PR_NUMBER --json state,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks PR_NUMBER --watch --fail-fast
gh pr merge PR_NUMBER --merge
scripts/elef-agent cleanup TASK
```

Do not create a local merge commit as a substitute for merging the PR. Only
use `git merge` when the user explicitly requests local branch integration and
the PR is not the intended merge boundary. Do not remove a task worktree until
its PR has been confirmed merged.

After confirming a merge, refresh the target branch locally and verify the
GitHub merge commit is reachable from that target before deleting the task
branch or worktree. Treat local `origin/*` refs as stale until fetched.

For a small, already-reviewed task that should be handed off quickly, the
primary checkout can run:

```sh
scripts/elef-agent finish TASK [TITLE]
```

This creates or reuses the task PR, waits for CI, merges it, confirms the merge,
and then performs the guarded cleanup. It leaves the task intact if CI fails
or the merge cannot be confirmed.

If the task is abandoned, the user can explicitly discard it with
`scripts/elef-agent remove TASK`.

## GitHub access

Authentication is supplied at runtime. `scripts/elef-agent start` accepts
`GITHUB_TOKEN` or `GH_TOKEN`, reads `.env`/`.env.local` if present, and falls
back to the host `gh auth token`. These files must remain untracked. The host
Codex auth file and GitHub CLI hosts file are mounted read-only when present.

Commit coherent changes on `codex/TASK`, push the branch, and create a draft PR
from inside the container when the implementation is ready. Do not merge the
PR without an explicit user request. When the user requests the merge, use the
GitHub PR as the merge boundary, confirm the merged state, and then clean up;
do not substitute a local merge commit. Use the persistent session to apply
review feedback.

## End a task

After the user has manually merged the PR:

```sh
scripts/elef-agent cleanup TASK
```

Cleanup requires a clean worktree and a confirmed merged PR, then removes the
container, host worktree, local branch, and remote task branch. For an
abandoned task, use `scripts/elef-agent remove TASK`; this force-removes the
worktree and local task branch but leaves any remote branch untouched.
