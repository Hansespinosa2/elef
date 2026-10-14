#!/usr/bin/env python3
"""CI timing ledger and standing status (read-only GitHub aggregation).

Two read-only reports over the GitHub Actions API, used by the nightly
diagnostic workflow and by the dev shepherd (see docs/ci-operations.md):

  timing  longest-first step timings plus per-job failure counts, over a
          recent window of CI, slow-lane, SQLite, and performance runs.
          This ledger is the measured input for future longest-first
          sharding; v0 only records it.
  status  standing status for dev/main: latest quick/slow lane runs, the
          CI-approved deploy refs, and what failed where.

Both subcommands exit 0 even when CI is red: they diagnose, they do not
gate. Live fetching needs `gh` authenticated (GH_TOKEN in CI); the pure
aggregation/render functions are covered by --self-test fixtures.

Usage:
  tooling/ci_report.py timing --repo owner/name [--window-hours 24] [--out ledger.json]
  tooling/ci_report.py status --repo owner/name [--branches dev,main] [--out health.json]
  tooling/ci_report.py --self-test
"""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path


FIXTURES = Path(__file__).resolve().parent / "ci_report_fixtures"

WORKFLOWS = ("CI", "slow-lane", "SQLite compatibility",
             "Native performance (non-gating)")
WORKFLOW_FILES = ("ci.yml", "slow-lane.yml", "sqlite-compatibility.yml",
                  "native-performance.yml")
RUN_FIELDS = "databaseId,conclusion,createdAt,event,headBranch,name,url,workflowName"


class GhError(Exception):
    pass


def run_gh(args: list[str]) -> object:
    try:
        result = subprocess.run(
            ["gh", *args], capture_output=True, text=True, check=False
        )
    except OSError as error:
        raise GhError(f"gh is not installed: {error}") from error
    if result.returncode:
        raise GhError(f"gh {' '.join(args)} failed: {result.stderr.strip()}")
    try:
        return json.loads(result.stdout or "null")
    except json.JSONDecodeError as error:
        raise GhError(f"gh {' '.join(args)} returned invalid JSON") from error


def parse_iso(value: str | None) -> datetime.datetime | None:
    if not value:
        return None
    try:
        moment = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment


def step_duration_s(step: dict) -> float | None:
    started = parse_iso(step.get("started_at"))
    completed = parse_iso(step.get("completed_at"))
    if started is None or completed is None:
        return None
    seconds = (completed - started).total_seconds()
    return seconds if seconds >= 0 else None


def aggregate_timings(jobs_payloads: list[dict]) -> dict:
    """Fold jobs-API payloads into per-step timing stats.

    Each payload is one ``actions/runs/<id>/jobs`` response extended with
    ``_workflow`` and ``_run_id`` keys by the fetcher.
    """
    steps: dict[tuple[str, str, str], dict] = {}
    for payload in jobs_payloads:
        workflow = payload.get("_workflow", "?")
        for job in payload.get("jobs", []):
            job_name = job.get("name", "?")
            for step in job.get("steps", []):
                key = (workflow, job_name, step.get("name", "?"))
                entry = steps.setdefault(
                    key, {"runs": 0, "failures": 0, "total_s": 0.0, "max_s": 0.0}
                )
                duration = step_duration_s(step)
                if duration is None:
                    continue
                entry["runs"] += 1
                if step.get("conclusion") not in ("success", "skipped", None):
                    entry["failures"] += 1
                entry["total_s"] += duration
                entry["max_s"] = max(entry["max_s"], duration)
    rows = [
        {
            "workflow": workflow,
            "job": job,
            "step": step,
            "runs": entry["runs"],
            "failures": entry["failures"],
            "avg_s": round(entry["total_s"] / entry["runs"], 1) if entry["runs"] else 0.0,
            "max_s": round(entry["max_s"], 1),
        }
        for (workflow, job, step), entry in steps.items()
        if entry["runs"]
    ]
    rows.sort(key=lambda row: (-row["avg_s"], row["workflow"], row["job"], row["step"]))
    return {"steps": rows}


def render_timing_markdown(ledger: dict, window_hours: int, run_count: int) -> str:
    """Render the longest-first timing tables for a step summary."""
    lines = [
        "## CI timing ledger (longest-first)",
        "",
        f"- Window: last {window_hours}h across {run_count} completed runs",
        "- Policy: overhead first (caches, in-job lanes), then longest-first sharding; "
        "no sharding change lands without two weeks of ledger data (see docs/ci-operations.md)",
        "",
        "| Avg | Max | Fails | Workflow | Job | Step |",
        "|---|---|---|---|---|---|",
    ]
    for row in ledger["steps"][:20]:
        lines.append(
            f"| {row['avg_s']}s | {row['max_s']}s | {row['failures']} "
            f"| {row['workflow']} | `{row['job']}` | {row['step']} |"
        )
    failing = [row for row in ledger["steps"] if row["failures"]]
    lines += ["", "### Steps with failures in window"]
    if not failing:
        lines.append("- none")
    else:
        for row in failing[:10]:
            lines.append(
                f"- {row['workflow']} / `{row['job']}` / {row['step']}: "
                f"{row['failures']}/{row['runs']} failed"
            )
    return "\n".join(lines) + "\n"


def fetch_timing(repo: str, window_hours: int, limit_per_workflow: int) -> tuple[dict, int]:
    """Fetch recent runs and their job timings from the Actions API."""
    since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
        hours=window_hours
    )
    payloads: list[dict] = []
    run_count = 0
    for workflow in (*WORKFLOWS, *WORKFLOW_FILES):
        runs = run_gh([
            "run", "list", "--repo", repo, "--workflow", workflow,
            "--created", f">={since.date().isoformat()}",
            "--limit", str(limit_per_workflow), "--json", RUN_FIELDS,
        ])
        if not isinstance(runs, list):
            continue
        for run in runs:
            created = parse_iso(run.get("createdAt"))
            if created is not None and created < since:
                continue
            if run.get("conclusion") in (None, ""):
                continue
            jobs = run_gh([
                "api", f"repos/{repo}/actions/runs/{run['databaseId']}/jobs?per_page=100",
            ])
            if not isinstance(jobs, dict):
                continue
            jobs["_workflow"] = run.get("workflowName") or workflow
            jobs["_run_id"] = run["databaseId"]
            payloads.append(jobs)
            run_count += 1
    ledger = aggregate_timings(payloads)
    ledger["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    ledger["window_hours"] = window_hours
    return ledger, run_count


def select_branch_health(
    branch_runs: dict[str, list[dict]],
    failing_jobs: dict[int, list[str]],
    deploy_refs: dict[str, str],
    branch_tips: dict[str, str],
) -> dict:
    """Fold raw run/ref records into per-branch health entries."""
    branches = []
    for branch, runs in branch_runs.items():
        ordered = sorted(runs, key=lambda run: run.get("createdAt", ""), reverse=True)
        latest = ordered[0] if ordered else None
        latest_completed = next(
            (run for run in ordered if run.get("conclusion") not in (None, "")), None
        )
        failing: list[str] = []
        if latest_completed and latest_completed.get("conclusion") != "success":
            failing = failing_jobs.get(latest_completed["databaseId"], [])
        ref = f"elef-deploy-{branch}"
        branches.append({
            "branch": branch,
            "latest_run": {
                "name": latest.get("workflowName") if latest else None,
                "conclusion": (latest.get("conclusion") or "in_progress") if latest else "none",
                "url": latest.get("url") if latest else None,
            },
            "failing_jobs": failing,
            "deploy_ref": ref,
            "deploy_sha": deploy_refs.get(ref),
            "branch_tip": branch_tips.get(branch),
            "deployed": bool(
                deploy_refs.get(ref)
                and branch_tips.get(branch)
                and deploy_refs[ref] == branch_tips[branch]
            ),
        })
    return {"branches": branches}


def render_status_markdown(health: dict) -> str:
    """Render the standing-status block the shepherd posts."""
    when = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"### Elef CI standing status ({when})",
        "",
        "| Branch | Latest lane run | Deploy ref | Tip deployed? |",
        "|---|---|---|---|",
    ]
    for entry in health["branches"]:
        run = entry["latest_run"]
        run_cell = f"{run['name'] or '?'}: {run['conclusion']}"
        if run["url"]:
            run_cell += f" ([run]({run['url']}))"
        sha = (entry["deploy_sha"] or "none")[:12]
        lines.append(
            f"| `{entry['branch']}` | {run_cell} "
            f"| `{entry['deploy_ref']}` @ `{sha}` "
            f"| {'yes' if entry['deployed'] else 'NO'} |"
        )
    lines += ["", "#### What failed where"]
    any_failing = False
    for entry in health["branches"]:
        if entry["failing_jobs"]:
            any_failing = True
            run = entry["latest_run"]
            lines.append(
                f"- `{entry['branch']}` {run['name']}: "
                + ", ".join(f"`{job}`" for job in entry["failing_jobs"])
                + (f" ([run]({run['url']}))" if run["url"] else "")
            )
    if not any_failing:
        lines.append("- no failing jobs on the latest completed lane runs")
    return "\n".join(lines) + "\n"


def fetch_status(repo: str, branches: list[str]) -> dict:
    """Fetch the latest lane runs and deploy refs for each branch."""
    branch_runs: dict[str, list[dict]] = {}
    failing_jobs: dict[int, list[str]] = {}
    branch_tips: dict[str, str] = {}
    for branch in branches:
        runs: list[dict] = []
        for workflow in ("ci.yml", "slow-lane.yml"):
            listed = run_gh([
                "run", "list", "--repo", repo, "--branch", branch,
                "--workflow", workflow, "--limit", "5", "--json", RUN_FIELDS,
            ])
            if isinstance(listed, list):
                runs.extend(listed)
        branch_runs[branch] = runs
        ordered = sorted(runs, key=lambda run: run.get("createdAt", ""), reverse=True)
        latest_completed = next(
            (run for run in ordered if run.get("conclusion") not in (None, "")), None
        )
        if latest_completed and latest_completed.get("conclusion") != "success":
            jobs = run_gh([
                "api",
                f"repos/{repo}/actions/runs/{latest_completed['databaseId']}/jobs?per_page=100",
            ])
            if isinstance(jobs, dict):
                failing_jobs[latest_completed["databaseId"]] = [
                    job.get("name", "?")
                    for job in jobs.get("jobs", [])
                    if job.get("conclusion") not in ("success", "skipped", None)
                ]
        tip = run_gh(["api", f"repos/{repo}/commits/{branch}"])
        if isinstance(tip, dict) and tip.get("sha"):
            branch_tips[branch] = tip["sha"]
    refs = run_gh(["api", f"repos/{repo}/git/matching-refs/heads/elef-deploy-"])
    deploy_refs: dict[str, str] = {}
    if isinstance(refs, list):
        for ref in refs:
            name = ref.get("ref", "").replace("refs/heads/", "")
            sha = (ref.get("object") or {}).get("sha")
            if name and sha:
                deploy_refs[name] = sha
    health = select_branch_health(branch_runs, failing_jobs, deploy_refs, branch_tips)
    health["generated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return health


def self_test() -> int:
    """Prove aggregation and rendering against saved API payloads."""
    failures = 0

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal failures
        if condition:
            print(f"{name}: PASS")
        else:
            failures += 1
            print(f"{name}: FAIL {detail}", file=sys.stderr)

    jobs_fixture = FIXTURES / "timing_jobs.json"
    expected_ledger = FIXTURES / "timing_ledger.expected.json"
    if not jobs_fixture.is_file() or not expected_ledger.is_file():
        print("timing fixtures are missing", file=sys.stderr)
        return 1
    ledger = aggregate_timings(json.loads(jobs_fixture.read_text()))
    expected = json.loads(expected_ledger.read_text())
    check("timing-aggregate", ledger == expected,
          f"\n{json.dumps(ledger, indent=2)}\n!=\n{json.dumps(expected, indent=2)}")
    timing_md = render_timing_markdown(ledger, 24, 2)
    check("timing-render-order",
          timing_md.index("Install Linux") < timing_md.index("Run the fast"),
          "longest-first order broken")
    check("timing-render-failures", "1/2 failed" in timing_md, timing_md)

    status_runs = FIXTURES / "status_branch_runs.json"
    expected_health = FIXTURES / "status_health.expected.json"
    if not status_runs.is_file() or not expected_health.is_file():
        print("status fixtures are missing", file=sys.stderr)
        return 1
    raw = json.loads(status_runs.read_text())
    health = select_branch_health(
        raw["branch_runs"],
        {int(key): value for key, value in raw["failing_jobs"].items()},
        raw["deploy_refs"],
        raw["branch_tips"],
    )
    check("status-aggregate", health == json.loads(expected_health.read_text()),
          json.dumps(health, indent=2))
    status_md = render_status_markdown(health)
    check("status-render",
          "`dev`" in status_md and "`desktop-macos`" in status_md
          and "elef-deploy-dev" in status_md,
          status_md)

    check("iso-parse", parse_iso("not-a-time") is None and parse_iso(None) is None)
    check("step-duration-missing",
          step_duration_s({"started_at": None, "completed_at": None}) is None)
    if failures:
        return 1
    print("ci_report self-test: aggregation and rendering PASS")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="CI timing ledger and standing status")
    parser.add_argument("--self-test", action="store_true")
    sub = parser.add_subparsers(dest="command")
    timing = sub.add_parser("timing", help="longest-first step timing ledger")
    timing.add_argument("--repo", default="Hansespinosa2/elef")
    timing.add_argument("--window-hours", type=int, default=24)
    timing.add_argument("--limit-per-workflow", type=int, default=20)
    timing.add_argument("--out", help="write the ledger JSON to this path")
    status = sub.add_parser("status", help="standing status for dev/main")
    status.add_argument("--repo", default="Hansespinosa2/elef")
    status.add_argument("--branches", default="dev,main")
    status.add_argument("--out", help="write the health JSON to this path")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    try:
        if args.command == "timing":
            ledger, run_count = fetch_timing(
                args.repo, args.window_hours, args.limit_per_workflow
            )
            if args.out:
                Path(args.out).write_text(json.dumps(ledger, indent=2) + "\n")
            print(render_timing_markdown(ledger, args.window_hours, run_count), end="")
            return 0
        if args.command == "status":
            health = fetch_status(args.repo, args.branches.split(","))
            if args.out:
                Path(args.out).write_text(json.dumps(health, indent=2) + "\n")
            print(render_status_markdown(health), end="")
            return 0
    except GhError as error:
        print(f"ci_report: {error}", file=sys.stderr)
        return 1
    parser.error("one of timing, status, or --self-test is required")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
