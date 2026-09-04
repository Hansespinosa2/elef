---
name: elef-agent
description: Use Elef's disposable Apple Container workflow for repository implementation tasks that should run in an isolated Codex worktree.
---

# Elef disposable agent workflow

Use this skill when implementing or reviewing Elef code in an isolated task.
The workflow gives each task a real host Git worktree and a persistent Apple
Container. The worktree is mounted into the container, so edits made by Codex
are immediately present on the host worktree; it is not a second copy inside
the container.

Run commands from the Elef repository root. Do not make task changes directly
in the main checkout.

## Start a task

```sh
scripts/elef-agent start TASK
scripts/elef-agent codex TASK
```

Use `scripts/elef-agent start TASK BASE` when the task must branch from a
specific commit or branch. The task branch is `codex/TASK` and the worktree is
the sibling directory `../elef-worktrees/TASK`.

Codex is launched in the container with approvals and sandbox bypassed and
model `gpt-5.6-luna`. Treat the container as the isolation boundary, but
remember that the mounted task worktree and shared Git metadata are host files.

## Continue and inspect

```sh
scripts/elef-agent resume TASK
scripts/elef-agent shell TASK
scripts/elef-agent shell TASK bin/rails test
```

Keep browser automation headless. Use the installed Chromium and Chrome
DevTools MCP for browser checks. Run the smallest relevant tests first.

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
