---
name: elef-agent
description: Deprecated. Do not use Elef's retired Apple Container workflow.
---

# Retired workflow

Do not launch, resume, fork, or clean up tasks with `scripts/elef-agent`.
Elef agents now run natively on the user's Omarchy device in the current
checkout. The legacy script remains only to print a retirement notice.

To make the host GitHub CLI credential available to supported agent
processes, install the interactive shell wrappers once with:

```sh
scripts/install-agent-gh-auth
```

This wraps `agy`, `codex`, `opencode`, and `hermes` so `GH_TOKEN` and
`GITHUB_TOKEN` are read from the host `gh` login at launch time and passed to
the agent process tree. Tokens must never be printed or stored in the repo.
