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

start_local_postgres() {
  [[ -n "${PGHOST:-}" || -n "${ELEF_USE_SQLITE:-}" ]] && return

  local pg_data="${ELEF_PGDATA:-storage/postgres}"
  local pg_bin
  pg_bin="$(find /usr/lib/postgresql -type f -name postgres | sort -V | tail -n 1)"
  [[ -n "$pg_bin" ]] || return

  local pg_root
  pg_root="$(dirname "$pg_bin")"
  mkdir -p "$(dirname "$pg_data")"
  if [[ ! -f "$pg_data/PG_VERSION" ]]; then
    "$pg_root/initdb" --pgdata="$pg_data" --auth=trust --username=developer --no-locale --encoding=UTF8 >/dev/null
  fi

  export PGHOST=127.0.0.1
  export PGUSER=developer
  export PGPORT="${PGPORT:-5432}"
  if ! pg_isready --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" >/dev/null 2>&1; then
    "$pg_root/pg_ctl" --pgdata="$pg_data" --log="$pg_data/server.log" \
      --options="-h $PGHOST -p $PGPORT" start >/dev/null
  fi
  for database in elef_development elef_test; do
    createdb --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" "$database" 2>/dev/null || true
  done
}

if [[ "${1:-}" == web ]]; then
  shift
  start_local_postgres
  bundle install
  bin/rails db:prepare
  bin/rails tailwindcss:build
  exec bin/rails server -b "${BIND:-0.0.0.0}" -p "${PORT:-3000}" "$@"
fi

exec "$@"
