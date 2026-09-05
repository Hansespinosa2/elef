#!/usr/bin/env bash
set -euo pipefail

GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-$HOME/.config/git/config}"
export GIT_CONFIG_GLOBAL

mkdir -p "$CODEX_HOME" "$HOME/.config/gh" "$(dirname "$GIT_CONFIG_GLOBAL")"
if [[ -f "$HOME/.gitconfig" && ! -e "$GIT_CONFIG_GLOBAL" ]]; then
  cp "$HOME/.gitconfig" "$GIT_CONFIG_GLOBAL"
fi

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
