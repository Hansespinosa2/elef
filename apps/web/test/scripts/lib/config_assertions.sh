#!/usr/bin/env bash
# Shared assertions for the repository launcher scripts.
#
# Compose files, Dockerfiles, and shell launchers accumulate commented-out
# settings that read exactly like live ones. Matching raw file text therefore
# proves nothing: delete the `image: postgres:17` service and a plain
# `grep -F` still finds the dead line, so the launcher suite passes while the
# launcher is broken. Every content assertion below strips full-line comments
# first and matches only what the launchers actually run.

# Fails unless an active (uncommented) line of $1 contains the literal $2.
assert_active_line() {
  local file="$1" needle="$2"
  if grep -v -E '^[[:space:]]*#' "$file" | grep -F -e "$needle" >/dev/null 2>&1; then
    return 0
  fi

  echo "expected an active line in $file to contain: $needle" >&2
  return 1
}

# Fails unless $2 appears in the literal string $1.
assert_output_contains() {
  local output="$1" needle="$2"
  if [[ "$output" == *"$needle"* ]]; then
    return 0
  fi

  echo "missing '$needle' in output: $output" >&2
  return 1
}

# Proves assert_active_line rejects a commented-out line, so the launcher
# suites cannot silently go back to trusting comments.
assert_active_line_rejects_comments() {
  local scratch_file
  scratch_file="$(mktemp)"

  printf '    # image: postgres:17\n' > "$scratch_file"
  if assert_active_line "$scratch_file" "image: postgres:17" 2>/dev/null; then
    rm -f "$scratch_file"
    echo "assert_active_line matched a commented-out line" >&2
    return 1
  fi

  printf '    image: postgres:17\n' > "$scratch_file"
  if ! assert_active_line "$scratch_file" "image: postgres:17"; then
    rm -f "$scratch_file"
    return 1
  fi

  rm -f "$scratch_file"
}
