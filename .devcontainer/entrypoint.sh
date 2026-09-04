#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$CODEX_HOME" "$HOME/.config/gh"
if [[ ! -e "$CODEX_HOME/config.toml" ]]; then
  cp /etc/elef/codex-config.toml "$CODEX_HOME/config.toml"
fi

if command -v gh >/dev/null 2>&1; then
  git config --global credential.helper '!gh auth git-credential' || true
fi

if [[ "${1:-}" == web ]]; then
  shift
  bundle install
  bin/rails db:prepare
  bin/rails tailwindcss:build
  exec bin/rails server -b "${BIND:-0.0.0.0}" -p "${PORT:-3000}" "$@"
fi

exec "$@"
