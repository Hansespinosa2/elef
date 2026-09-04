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
model `gpt-5.6-luna`. Treat the container as the isolation boundary, but
remember that the mounted task worktree and shared Git metadata are host files.

## Continue and inspect

```sh
scripts/elef-agent resume TASK
scripts/elef-agent shell TASK
scripts/elef-agent shell TASK bin/rails test
scripts/elef-agent codex TASK
```

Keep browser automation headless. Use the installed Chromium and Chrome
DevTools MCP for browser checks. Run the smallest relevant tests first.

## Merge and cleanup

The primary agent reviews and merges task branches. Do not merge into the
primary checkout automatically, and do not remove a task worktree before its
changes have been reviewed and merged:

```sh
git merge --ff-only codex/TASK
scripts/elef-agent cleanup TASK
```

If the task is abandoned, the user can explicitly discard it with
`scripts/elef-agent remove TASK`.

## GitHub access

Authentication is supplied at runtime. `scripts/elef-agent start` accepts
`GITHUB_TOKEN` or `GH_TOKEN`, reads `.env`/`.env.local` if present, and falls
back to the host `gh auth token`. These files must remain untracked. The host
Codex auth file and GitHub CLI hosts file are mounted read-only when present.

Commit coherent changes on `codex/TASK`, push the branch, and create a draft PR
from inside the container when the implementation is ready. Do not merge the
PR automatically; the user reviews and merges it manually. Use the persistent
session to apply review feedback.

## End a task

After the user has manually merged the PR:

```sh
scripts/elef-agent cleanup TASK
```

Cleanup requires a clean worktree and a confirmed merged PR, then removes the
container, host worktree, local branch, and remote task branch. For an
abandoned task, use `scripts/elef-agent remove TASK`; this force-removes the
worktree and local task branch but leaves any remote branch untouched.
