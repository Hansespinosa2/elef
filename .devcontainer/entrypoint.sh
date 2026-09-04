#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$CODEX_HOME" "$HOME/.config/gh"
if [[ ! -e "$CODEX_HOME/config.toml" ]]; then
  cp /etc/elef/codex-config.toml "$CODEX_HOME/config.toml"
fi

if command -v gh >/dev/null 2>&1; then
  git config --global credential.helper '!gh auth git-credential' || true
fi

exec "$@"
