#!/usr/bin/env bash
set -euo pipefail

environment="${1:?usage: rails_environment_smoke_test.sh <development|production> <port>}"
port="${2:?usage: rails_environment_smoke_test.sh <development|production> <port>}"

case "$environment" in
  development|production) ;;
  *) echo "unsupported Rails environment: $environment" >&2; exit 2 ;;
esac

log_file="$(mktemp)"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT

export RAILS_ENV="$environment"
export SECRET_KEY_BASE="elef-smoke-test-secret-key-base-not-for-production-use"
export RAILS_LOG_TO_STDOUT=true
mkdir -p storage

bin/rails db:prepare
bin/rails server -e "$environment" -b 127.0.0.1 -p "$port" >"$log_file" 2>&1 &
server_pid="$!"

for attempt in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$port/up" >/dev/null; then
    break
  fi
  if [[ "$attempt" == 60 ]] || ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  sleep 1
done

bin/rails runner 'expected = ENV.fetch("RAILS_ENV"); abort "wrong Rails environment" unless Rails.env.to_s == expected; abort "wrong database adapter" unless ActiveRecord::Base.connection.adapter_name == "SQLite"; storage = Rails.root.join("storage"); probe = storage.join(".write-check"); File.write(probe, "ok"); File.delete(probe); puts "#{expected} smoke ok"'
