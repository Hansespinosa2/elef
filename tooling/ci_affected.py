#!/usr/bin/env python3
"""CI affected-job planner.

Maps a changed-file list (one path per line, as emitted by
``git diff --name-only``) to the CI evidence jobs that can observe the
change. v0 runs in SHADOW mode: the plan is reported in the PR summary
and recorded as an artifact, but no required job is ever skipped. See
docs/ci-operations.md for the lane design and the enforcement-flip
checklist that must pass before any skip is honored.

Usage:
  tooling/ci_affected.py --diff-file <path> [--format table|json] [--out plan.json]
  tooling/ci_affected.py --base origin/dev [--head HEAD] [--format table|json]
  tooling/ci_affected.py --self-test
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from pathlib import Path


PLANNER = "tooling/ci_affected.py"
PLANNER_VERSION = "v0"
MODE = "shadow"
ENFORCED = False

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "ci_affected_fixtures"

# Canonical evidence-job order, matching the release-gate needs list.
EVIDENCE_JOBS = (
    "desktop-fast",
    "scan_ruby",
    "scan_js",
    "test",
    "sqlite-test",
    "system-test",
    "affected",
    "desktop",
    "arch-package",
    "desktop-macos",
    "renderer-macos",
    "production-smoke",
    "development-smoke",
)

ALL = frozenset(EVIDENCE_JOBS)
SCANS = frozenset({"scan_ruby", "scan_js"})

# Conservative job sets per change area. Anything not matched below falls
# through to ALL. Lockfile changes always route to BOTH desktop jobs so the
# in-job audits observe them on Linux and macOS.
QUICK_ONLY = frozenset({"desktop-fast"})
WEB_RUBY = ALL - {"arch-package", "scan_ruby", "scan_js"}
WEB_LOCK = ALL - {"arch-package"}
SHARED_PACKAGE = ALL - {"arch-package", "scan_ruby", "scan_js"}
DESKTOP_NATIVE = frozenset(
    {"desktop-fast", "affected", "desktop", "desktop-macos", "arch-package"}
)
DESKTOP_FRONTEND = frozenset(
    {"desktop-fast", "affected", "desktop", "desktop-macos", "arch-package"}
)
ROOT_JS_LOCK = frozenset(
    {
        "desktop-fast",
        "system-test",
        "affected",
        "desktop",
        "desktop-macos",
        "renderer-macos",
    }
)
FRONTEND_JS_LOCK = frozenset(
    {"desktop-fast", "affected", "desktop", "desktop-macos"}
)
CONFORMANCE = frozenset({"desktop-fast", "system-test", "affected"})
# ops/* is exercised by the smoke jobs and by the instance/launcher scripts
# that run inside the test job.
OPS = frozenset({"test", "production-smoke", "development-smoke"})
CHECKERS = frozenset({"desktop-fast", "affected"})
# The e2e harness runs in the desktop jobs (and its unit tests in
# desktop-fast); ci_single_run_test.rb, which runs in the test job, asserts
# on the structure of run.mjs.
E2E = frozenset({"test", "desktop-fast", "desktop", "desktop-macos"})
SPEC_TESTS = frozenset({"affected"})
CONFORMANCE_RUNNER = frozenset({"system-test", "affected"})

# First match wins within one file; affected sets union across files.
RULES: tuple[tuple[str, tuple[str, ...], frozenset], ...] = (
    ("workflow", (".github/workflows/*",), ALL),
    ("planner", ("tooling/ci_affected.py", "tooling/ci_affected_fixtures/*",
                 "tooling/ci_report.py", "tooling/ci_report_fixtures/*"), CHECKERS),
    ("release-tooling", ("tooling/release/*", "apps/web/test/scripts/*"), frozenset({"test"})),
    ("checker-tooling", ("tooling/check_*.py", "tooling/check_*.rb", "tooling/canary/*"), CHECKERS),
    ("root-config", (".ruby-version", "package.json", "tsconfig.base.json", "Cargo.toml",
                     ".gitattributes", ".dockerignore"), ALL),
    ("contracts", ("packages/contracts/*",), ALL),
    ("shared-package", ("packages/work-model/*", "packages/renderer/*",
                        "packages/client/*", "packages/editor-runtime/*"), SHARED_PACKAGE),
    ("cargo-lock", ("Cargo.lock",), DESKTOP_NATIVE),
    ("rust", ("crates/*", "apps/desktop/src-tauri/*"), DESKTOP_NATIVE),
    ("desktop-packaging", ("apps/desktop/packaging/*", "apps/desktop/scripts/*",
                           "apps/desktop/release/*"), DESKTOP_NATIVE),
    ("root-js-lock", ("package-lock.json",), ROOT_JS_LOCK),
    ("frontend-js-lock", ("apps/desktop/frontend/package-lock.json",), FRONTEND_JS_LOCK),
    ("e2e-js-lock", ("apps/desktop/e2e/package-lock.json",), FRONTEND_JS_LOCK),
    ("desktop-frontend", ("apps/desktop/frontend/*",), DESKTOP_FRONTEND),
    ("desktop-e2e", ("apps/desktop/e2e/*",), E2E),
    ("gemfile-lock", ("apps/web/Gemfile.lock", "apps/web/Gemfile",
                      "apps/web/config/importmap.rb"), WEB_LOCK),
    ("web-frontend", ("apps/web/app/assets/*", "apps/web/app/javascript/*",
                      "apps/web/test/javascript/*"), WEB_RUBY),
    ("web", ("apps/web/*",), WEB_RUBY),
    ("conformance", ("tests/host-conformance/*",), CONFORMANCE),
    ("spec-tests", ("tests/spec/*", "spec/*"), SPEC_TESTS),
    ("js-tests", ("tests/*",), CONFORMANCE_RUNNER),
    ("ops", ("ops/*",), OPS),
    ("tier-runner", ("bin/check",), frozenset({"affected"})),
    ("docs", ("docs/*", "*.md", "LICENSE"), QUICK_ONLY),
)


def classify(path: str) -> tuple[str, frozenset]:
    """Return the (rule, jobs) pair for one changed path."""
    normalized = path.strip().lstrip("./")
    for name, patterns, jobs in RULES:
        for pattern in patterns:
            if pattern.startswith("*."):
                if fnmatch.fnmatch(normalized.rsplit("/", 1)[-1], pattern):
                    return name, jobs
            elif fnmatch.fnmatch(normalized, pattern):
                return name, jobs
    return "default-all", ALL


def plan(paths: list[str]) -> dict:
    """Build the shadow plan for a changed-file list."""
    files = sorted({path.strip().lstrip("./") for path in paths if path.strip()})
    reasons: dict[str, set[str]] = {}
    if not files:
        for job in ALL:
            reasons.setdefault(job, set()).add("empty-diff")
    for path in files:
        rule, jobs = classify(path)
        for job in jobs:
            reasons.setdefault(job, set()).add(rule)
    affected = [job for job in EVIDENCE_JOBS if job in reasons]
    suggested_skips = [job for job in EVIDENCE_JOBS if job not in reasons]
    return {
        "planner": PLANNER,
        "planner_version": PLANNER_VERSION,
        "mode": MODE,
        "enforced": ENFORCED,
        "files": len(files),
        "affected": affected,
        "suggested_skips": suggested_skips,
        "reasons": {
            job: sorted(reasons[job]) for job in affected
        },
    }


def render_table(result: dict) -> str:
    """Render the plan as a Markdown summary fragment."""
    lines = [
        "## CI plan (shadow: nothing is skipped)",
        "",
        f"- Planner: `{result['planner']}` ({result['planner_version']}, mode {result['mode']})",
        f"- Changed files: {result['files']}",
        f"- Would run ({len(result['affected'])}): {', '.join('`' + j + '`' for j in result['affected'])}",
    ]
    if result["suggested_skips"]:
        lines.append(
            f"- Shadow suggested skips ({len(result['suggested_skips'])}): "
            + ", ".join("`" + j + "`" for j in result["suggested_skips"])
        )
    else:
        lines.append("- Shadow suggested skips (0): none; the full suite stays required")
    lines += ["", "| Job | Pulled in by |", "|---|---|"]
    for job in result["affected"]:
        lines.append(f"| `{job}` | {', '.join(result['reasons'][job])} |")
    return "\n".join(lines) + "\n"


def files_from_git(base: str, head: str) -> list[str]:
    diff = subprocess.run(
        ["git", "-C", str(ROOT), "diff", "--name-only", f"{base}...{head}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if diff.returncode:
        raise SystemExit(f"git diff {base}...{head} failed: {diff.stderr.strip()}")
    return diff.stdout.splitlines()


# Inline rule-order pins: each path must match the named rule, proving the
# specific-before-general ordering independent of the fixture files.
INLINE_CASES = (
    ("apps/web/test/scripts/ci_single_run_test.rb", "release-tooling"),
    ("apps/web/test/javascript/shared/x.test.js", "web-frontend"),
    ("apps/web/app/models/work.rb", "web"),
    ("tests/host-conformance/suite.js", "conformance"),
    ("tests/spec/editor-markup-vocabulary.test.js", "spec-tests"),
    ("spec/fixtures/manifest-v1.json", "spec-tests"),
    ("apps/desktop/e2e/package-lock.json", "e2e-js-lock"),
    ("apps/desktop/frontend/src/main.js", "desktop-frontend"),
    ("docs/ci-operations.md", "docs"),
    ("README.md", "docs"),
    ("some/new/top-level/path.txt", "default-all"),
)


def self_test() -> int:
    """Prove every fixture diff maps to its expected job sets."""
    failures = 0
    for path, expected_rule in INLINE_CASES:
        rule, _ = classify(path)
        if rule != expected_rule:
            print(f"{path}: rule {rule} != expected {expected_rule}", file=sys.stderr)
            failures += 1
    if not FIXTURES.is_dir():
        print("ci_affected fixtures are missing", file=sys.stderr)
        return 1
    count = 0
    for diff_file in sorted(FIXTURES.glob("*.diff")):
        expected_file = diff_file.with_suffix(".expected.json")
        count += 1
        if not expected_file.is_file():
            print(f"{diff_file.name}: missing {expected_file.name}", file=sys.stderr)
            failures += 1
            continue
        expected = json.loads(expected_file.read_text())
        result = plan(diff_file.read_text().splitlines())
        problems = []
        if set(result["affected"]) != set(expected["affected"]):
            problems.append(
                f"affected {sorted(result['affected'])} != expected {sorted(expected['affected'])}"
            )
        if set(result["suggested_skips"]) != set(expected["suggested_skips"]):
            problems.append(
                f"suggested_skips {sorted(result['suggested_skips'])} != "
                f"expected {sorted(expected['suggested_skips'])}"
            )
        if problems:
            failures += 1
            print(f"{diff_file.name}: FAIL", file=sys.stderr)
            for problem in problems:
                print(f"  {problem}", file=sys.stderr)
        else:
            print(f"{diff_file.name}: PASS")
    # Lockfile changes must route to BOTH desktop jobs so the in-job
    # audits observe them on each platform.
    for lockfile in ("package-lock.json",
                     "apps/desktop/frontend/package-lock.json",
                     "apps/desktop/e2e/package-lock.json",
                     "Cargo.lock"):
        _, jobs = classify(lockfile)
        if not {"desktop", "desktop-macos"} <= set(jobs):
            print(f"{lockfile}: does not route to both desktop jobs", file=sys.stderr)
            failures += 1
    if count == 0:
        print("no ci_affected fixtures found", file=sys.stderr)
        return 1
    if failures:
        return 1
    print(f"ci_affected self-test: {count} fixtures PASS, lockfile routing holds")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="CI affected-job planner (shadow)")
    parser.add_argument("--diff-file", help="changed-file list, one path per line ('-' for stdin)")
    parser.add_argument("--base", help="diff base ref for local preview (uses BASE...HEAD)")
    parser.add_argument("--head", default="HEAD", help="diff head ref (default HEAD)")
    parser.add_argument("--format", choices=("table", "json"), default="table")
    parser.add_argument("--out", help="also write the JSON plan to this path")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.diff_file:
        if args.diff_file == "-":
            raw = sys.stdin.read().splitlines()
        else:
            raw = Path(args.diff_file).read_text().splitlines()
    elif args.base:
        raw = files_from_git(args.base, args.head)
    else:
        parser.error("one of --diff-file, --base, or --self-test is required")
    result = plan(raw)
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
    if args.format == "json":
        print(json.dumps(result, indent=2))
    else:
        print(render_table(result), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
