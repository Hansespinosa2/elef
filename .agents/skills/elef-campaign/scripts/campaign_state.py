#!/usr/bin/env python3
"""Deterministic helper for the Elef refactor campaign state.

Workflow tooling only. The schema and rules it checks are owned by
docs/refactor/CONSTITUTION.md (section 1); this script never decides PASS.

Commands (run from anywhere inside the checkout):
  probe                     print the execution_environment object + extra facts
  validate [--json]         check status.json against git and evidence; exit 1 on errors
  reconstruct               report the earliest phase whose PASS cannot be proven
  init --base SHA           create status.json using the verified campaign base (no overwrite)
  prepare-gate N            create an owned candidate checkout; prepare locked dependencies there
  run-gate N [--attempt ID]  run isolated gate and select immutable completed-attempt evidence
  cleanup-gate N ID          remove only a clean owned gate worktree
  sha256 PATH               print the SHA-256 of a file
  set-env                   rewrite execution_environment in status.json from a fresh probe

Global option: --root PATH (defaults to the git toplevel); useful for disposable fixtures.
"""
from __future__ import annotations

import argparse
import glob
import functools
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid

REQUIRED_KEYS = {
    "campaign_version": int,
    "campaign_branch": str,
    "campaign_base_sha": str,
    "current_phase": int,
    "phase_state": str,
    "phase_base_sha": str,
    "head_sha": str,
    "review_round": int,
    "phase_contract_sha256": str,
    "frozen_plan_sha256": (str, type(None)),
    "last_completed_phase": (int, type(None)),
    "last_verified_checks": list,
    "execution_environment": dict,
    "pending_human_gates": list,
    "blocker": (dict, str, type(None)),
    "next_action": str,
}
STATES = {"PLAN", "DO", "CHECK", "ACT", "PASS", "BLOCKED"}
ENV_KEYS = ["os", "arch", "ram_mb", "swap_mb", "cpu_count", "free_disk_mb", "display_mode", "tauri_native_runner"]
# Files that may change after the reviewed candidate (head_sha) without invalidating the review.
POST_CANDIDATE_ALLOWED = ("docs/refactor/status.json", "docs/refactor/reviews/", "docs/refactor/execution/")
MAX_REVIEW_ROUNDS = 10
PLANNING_ALLOWED = ("docs/", ".agents/", "AGENTS.md", "README.md", "bootstrap/", "DROP-IN.md", "CLAUDE.md", ".claude/")


def allowed_path(path, entries):
    return any(path.startswith(entry) if entry.endswith("/") else path == entry for entry in entries)


def production_paths(paths):
    return [path for path in paths if not allowed_path(path, PLANNING_ALLOWED)]


def effective_state(st):
    return st.get("blocker", {}).get("resume_state") if st.get("phase_state") == "BLOCKED" and isinstance(st.get("blocker"), dict) else st.get("phase_state")


def git(root: str, *args: str, check: bool = True) -> str:
    out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout.strip()


def git_ok(root: str, *args: str) -> bool:
    return subprocess.run(["git", "-C", root, *args], capture_output=True).returncode == 0


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def phase_file(root: str, n: int) -> str | None:
    hits = sorted(glob.glob(os.path.join(root, "docs/refactor/phases", f"{n:02d}-*.md")))
    return hits[0] if len(hits) == 1 else None


def all_phases(root: str) -> list[int]:
    files = glob.glob(os.path.join(root, "docs/refactor/phases", "*.md"))
    expected = set(range(13))
    found = []
    for file in files:
        name = os.path.basename(file)
        if not re.match(r"^[0-9]{2}-.+\.md$", name):
            raise ValueError(f"unexpected phase contract: {name}")
        found.append(int(name[:2]))
    if set(found) != expected or len(found) != 13:
        raise ValueError("exactly one phase contract for every phase 00..12 is required")
    return list(range(13))


def plan_path(root: str, n: int) -> str:
    return os.path.join(root, "docs/refactor/execution", f"phase-{n}-plan.md")


def read_text(root: str, path: str, revision: str | None = None) -> str:
    if revision:
        r = subprocess.run(["git", "-C", root, "show", f"{revision}:{path}"], capture_output=True, text=True)
        if r.returncode:
            raise ValueError(f"missing {path} at {revision}")
        return r.stdout
    with open(os.path.join(root, path), encoding="utf-8") as f:
        return f.read()


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def full_commit(root: str, sha: str) -> bool:
    return isinstance(sha, str) and bool(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", sha)) and git_ok(root, "cat-file", "-e", f"{sha}^{{commit}}")


def process_start(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/stat") as stat:
            return stat.read().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def process_alive(pid, start=None) -> bool:
    if type(pid) is not int or pid <= 0:
        return False
    if start is not None and process_start(pid) != start:
        return False  # PID reused or process gone.
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def checkout_processes(checkout: str) -> list[int]:
    """Find owned Linux processes still using an attempt, including orphaned children."""
    found = []
    checkout = os.path.realpath(checkout)
    for path in glob.glob("/proc/[0-9]*/cwd"):
        try:
            cwd = os.path.realpath(os.readlink(path))
            if cwd == checkout or cwd.startswith(checkout + os.sep):
                found.append(int(path.split("/")[2]))
        except (OSError, ValueError):
            continue
    return found


def active_attempt(manifest: dict) -> list[int]:
    alive = checkout_processes(manifest["checkout"])
    if manifest.get("state") == "running":
        for kind in ("runner", "child"):
            pid = manifest.get(kind + "_pid")
            if process_alive(pid, manifest.get(kind + "_start")):
                alive.append(pid)
    return sorted(set(alive))


def gate_evidence(root: str, n: int, revision: str | None = None) -> tuple[bool, str, str | None]:
    try:
        meta = json.loads(read_text(root, f"docs/refactor/execution/phase-{n}-gate.json", revision))
        attempt = meta.get("attempt_id")
        if not isinstance(attempt, str) or not re.fullmatch(r"[0-9a-f]{32}", attempt):
            raise ValueError("gate lacks immutable attempt identity")
        prefix = f"docs/refactor/execution/phase-{n}-gate-attempts/{attempt}"
        result = json.loads(read_text(root, prefix + "/result.json", revision))
        if result != meta or meta.get("state") != "completed":
            raise ValueError("selected gate is not a completed immutable attempt")
        snapshot_text = read_text(root, prefix + "/status.json", revision)
        snapshot = json.loads(snapshot_text)
        if meta.get("status_sha256") != digest(snapshot_text) or snapshot.get("head_sha") != meta.get("head") or snapshot.get("current_phase") != n or snapshot.get("phase_state") != "DO":
            raise ValueError("gate status snapshot identity/hash does not match its candidate")
        stdout = read_text(root, prefix + "/stdout.txt", revision)
        stderr = read_text(root, prefix + "/stderr.log", revision)
        if meta.get("stderr_sha256") != digest(stderr):
            raise ValueError("gate stderr hash mismatch")
        records = []
        for line in stdout.splitlines():
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict) and type(obj.get("phase")) is int and obj.get("phase") == n:
                records.append(obj)
        if len(records) != 1 or records[0].get("result") != "PASS":
            raise ValueError("gate must contain exactly one phase verdict JSON with result PASS")
        head = records[0].get("head")
        if not full_commit(root, head):
            raise ValueError("gate head must be a full existing commit SHA")
        if stdout.splitlines().count(f"ELEF_PHASE_{n}=PASS") != 1:
            raise ValueError("gate must contain exactly one exact PASS marker line")
        if meta.get("command") != f"bin/check phase {n} --json" or type(meta.get("exit")) is not int or meta["exit"] != 0:
            raise ValueError("gate command/exit metadata does not prove exit 0")
        if meta.get("head") != head or meta.get("stdout_sha256") != digest(stdout):
            raise ValueError("gate metadata candidate or stdout hash mismatch")
        return True, "ok", head
    except (OSError, ValueError, TypeError, AttributeError) as e:
        return False, str(e), None


def linked_evidence(root: str, n: int, st: dict, revision: str | None = None, require_pass: bool = True) -> list[str]:
    errors = []
    ok, why, head = gate_evidence(root, n, revision)
    if not ok and require_pass:
        errors.append(f"gate: {why}")
    if ok and head != st.get("head_sha"):
        errors.append("gate candidate differs from status.head_sha")
    k = st.get("review_round")
    if type(k) is not int or not 1 <= k <= MAX_REVIEW_ROUNDS:
        errors.append("review round must be 1..10")
        return errors
    try:
        report = read_text(root, f"docs/refactor/reviews/phase-{n}-round-{k}.md", revision)
        for field, expected in (("Candidate", st.get("head_sha")), ("Base", st.get("phase_base_sha"))):
            values = re.findall(rf"^{field}: (.+)$", report, re.MULTILINE)
            if values != [expected]:
                errors.append(f"review {field} must occur once and equal {expected}")
        results = re.findall(r"^Result: (.+)$", report, re.MULTILINE)
        if len(results) != 1 or not re.fullmatch(r"PASS|FAIL|BLOCKED\([^\n]+\)", results[0]):
            errors.append("review requires exactly one valid Result line")
        elif require_pass and results != ["PASS"]:
            errors.append("review Result must be PASS")
        context = json.loads(read_text(root, f"docs/refactor/execution/phase-{n}-round-{k}-context.json", revision))
        if context.get("conversation_inherited") is not False:
            errors.append("review receipt must explicitly declare no inherited conversation")
        if any(context.get(key) != value for key, value in (("phase", n), ("round", k), ("head", st.get("head_sha")), ("base", st.get("phase_base_sha")), ("conversation_inherited", False), ("report_sha256", digest(report)))):
            errors.append("review launch receipt does not match phase/round/candidate/base/report or fresh-context declaration")
        if not context.get("mechanism") or not context.get("identity") or not context.get("launch"):
            errors.append("review launch receipt lacks mechanism, identity or actual invocation")
        if context.get("state") != "completed" or not context.get("terminal_evidence"):
            errors.append("review lacks confirmed terminal session/process evidence")
        if re.findall(r"^Review context: (.+)$", report, re.MULTILINE) != [context.get("identity")]:
            errors.append("review identity differs from launch receipt")
        pf = phase_file(root, n)
        contract = read_text(root, os.path.relpath(pf, root), revision)
        ids = re.findall(r"\*\*(P\d{2}-\d{2})\*\*", contract)
        for criterion in ids:
            verdicts = re.findall(rf"^\|\s*{criterion}\s*\|\s*([^|]+?)\s*\|\s*[^|\s][^|]*\|", report, re.MULTILINE)
            allowed = {"PASS", "PENDING(ACT)"} if criterion == "P12-11" else {"PASS"}
            if not require_pass:
                allowed |= {"FAIL", "BLOCKED"}
            if len(verdicts) != 1 or verdicts[0] not in allowed:
                errors.append(f"review omits valid evidence for {criterion}")
        for i in range(1, 19):
            verdicts = re.findall(rf"^\|\s*I{i:02d}\s*\|\s*([^|]+?)\s*\|\s*[^|\s][^|]*\|", report, re.MULTILINE)
            allowed = {"PASS", "N.A."} if require_pass else {"PASS", "N.A.", "FAIL", "BLOCKED"}
            if len(verdicts) != 1 or verdicts[0] not in allowed:
                errors.append(f"review omits invariant I{i:02d}")
        plan = read_text(root, f"docs/refactor/execution/phase-{n}-plan.md", revision)
        if digest(plan) != st.get("frozen_plan_sha256") or digest(contract) != st.get("phase_contract_sha256"):
            errors.append("frozen plan/contract hashes differ from reviewed status")
        if ok:
            meta = json.loads(read_text(root, f"docs/refactor/execution/phase-{n}-gate.json", revision))
            snapshot = json.loads(read_text(root, f"docs/refactor/execution/phase-{n}-gate-attempts/{meta['attempt_id']}/status.json", revision))
            if any(snapshot.get(key) != st.get(key) for key in ("campaign_base_sha", "current_phase", "phase_base_sha", "head_sha", "frozen_plan_sha256", "phase_contract_sha256")):
                errors.append("gate status snapshot differs from reviewed phase/base/candidate/plan/contract")
        # Evidence commits may not silently change the plan or contract after the candidate.
        if full_commit(root, head):
            if digest(read_text(root, f"docs/refactor/execution/phase-{n}-plan.md", head)) != digest(plan):
                errors.append("plan differs from the candidate's frozen plan")
            if digest(read_text(root, os.path.relpath(pf, root), head)) != digest(contract):
                errors.append("contract differs from the candidate's contract")
    except (OSError, ValueError, TypeError, AttributeError) as e:
        errors.append(f"review/plan: {e}")
    return errors


@functools.lru_cache(maxsize=128)
def status_history_at(root: str, tip: str):
    records = []
    for commit in git(root, "log", "--first-parent", "--format=%H", tip, "--", "docs/refactor/status.json").splitlines():
        try:
            st = json.loads(read_text(root, "docs/refactor/status.json", commit))
            if isinstance(st, dict):
                records.append((commit, st))
        except (ValueError, OSError):
            continue
    return tuple(records)


def status_history(root: str):
    return status_history_at(root, git(root, "rev-parse", "HEAD"))


def freeze_errors(root: str, n: int, st: dict, tip: str) -> list[str]:
    history = list(reversed([record for record in status_history_at(root, tip) if record[1].get("current_phase") == n]))
    previous = None
    plan_entry = None
    found = False
    for commit, old in history:
        state = effective_state(old)
        prev_state = effective_state(previous[1]) if previous else None
        if state == "PLAN" and prev_state != "PLAN":
            plan_entry = git(root, "rev-parse", f"{commit}^") if previous else st["phase_base_sha"]
            found = False  # Every re-plan needs its own committed freeze, even with identical bytes.
        if state == "DO" and prev_state == "PLAN":
            try:
                frozen = old.get("frozen_plan_sha256")
                if frozen != digest(read_text(root, f"docs/refactor/execution/phase-{n}-plan.md", commit)):
                    return ["committed freeze hash does not match its plan"]
                if production_paths(git(root, "diff", "--name-only", f"{plan_entry}..{commit}").splitlines()):
                    return ["production changed before a committed PLAN-to-DO freeze"]
                if frozen == st.get("frozen_plan_sha256"):
                    found = True
            except (OSError, ValueError, RuntimeError):
                return ["committed freeze cannot be proven"]
        previous = commit, old
    return [] if found else ["no committed PLAN-to-DO freeze for this exact plan"]


def act_errors(root: str, n: int, st: dict, tip: str) -> list[str]:
    records = [(commit, old) for commit, old in status_history_at(root, tip) if old.get("current_phase") == n]
    # Skip the prospective/current PASS snapshots to find the actual authorization step.
    while records and records[0][1].get("phase_state") == "PASS":
        records.pop(0)
    if not records or records[0][1].get("phase_state") != "ACT":
        return ["PASS lacks a preceding committed ACT review decision"]
    commit, act = records[0]
    if any(act.get(key) != st.get(key) for key in ("head_sha", "phase_base_sha", "review_round", "frozen_plan_sha256", "phase_contract_sha256")):
        return ["committed ACT identity differs from PASS candidate/round/plan/contract"]
    before = next((old for _, old in records[1:] if effective_state(old) != "ACT"), None)
    if not before or effective_state(before) != "CHECK" or any(before.get(key) != act.get(key) for key in ("head_sha", "phase_base_sha", "review_round", "frozen_plan_sha256", "phase_contract_sha256")):
        return ["ACT lacks a committed CHECK for the same candidate and round"]
    return linked_evidence(root, n, act, commit)


@functools.lru_cache(maxsize=128)
def pass_checkpoint_at(root: str, tip: str, n: int) -> tuple[str | None, tuple[str, ...]]:
    for commit, st in status_history_at(root, tip):
        if st.get("current_phase") != n or st.get("phase_state") != "PASS":
            continue
        errors = linked_evidence(root, n, st, commit) + act_errors(root, n, st, commit)
        if st.get("last_completed_phase") != n:
            errors.append("PASS checkpoint has wrong last_completed_phase")
        base, head = st.get("phase_base_sha"), st.get("head_sha")
        if not full_commit(root, base) or not full_commit(root, head):
            errors.append("PASS checkpoint base/head is not a full commit SHA")
        elif not git_ok(root, "merge-base", "--is-ancestor", base, head) or not git_ok(root, "merge-base", "--is-ancestor", head, commit):
            errors.append("PASS checkpoint has broken base/candidate ancestry")
        else:
            errors += freeze_errors(root, n, st, head)
            changed = git(root, "diff", "--name-only", f"{head}..{commit}").splitlines()
            if any(not allowed_path(path, POST_CANDIDATE_ALLOWED) for path in changed):
                errors.append("implementation changed between candidate and PASS checkpoint")
        if n == 0:
            if base != st.get("campaign_base_sha"):
                errors.append("Phase 00 base differs from verified campaign base")
        else:
            predecessor, prev_errors = pass_checkpoint_at(root, tip, n-1)
            if not predecessor or base != predecessor:
                errors.append("phase base differs from the preceding proven PASS checkpoint")
        return (None if errors else commit), tuple(errors)
    return None, ("no committed ACT transition to PASS for this phase",)


def pass_checkpoint(root: str, n: int) -> tuple[str | None, list[str]]:
    commit, errors = pass_checkpoint_at(root, git(root, "rev-parse", "HEAD"), n)
    return commit, list(errors)


def phase_proven(root: str, n: int) -> tuple[bool, list[str]]:
    checkpoint, errors = pass_checkpoint(root, n)
    return checkpoint is not None, errors


def working_paths(root: str) -> list[str]:
    # Gate execution is isolated. For PLAN/candidate guards recognize every source/config extension.
    paths = set(git(root, "diff", "--name-only", "HEAD").splitlines())
    source_roots = ("app/", "apps/", "desktop/", "packages/", "crates/", "bin/", "tooling/", "ops/", "tests/", "test/", "spec/", "lib/", "config/", "script/", "scripts/", ".github/")
    for path in git(root, "ls-files", "--others", "--exclude-standard").splitlines():
        if path.startswith(source_roots) or path.endswith((".rb", ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sh", ".json", ".yaml", ".yml", ".toml", ".html", ".css", ".scss", ".erb", ".sql")) or path in {"Gemfile", "Gemfile.lock", "Cargo.lock", "Rakefile", "Dockerfile"}:
            paths.add(path)
    return sorted(paths)


def planning_anchor(root: str, st: dict) -> str:
    history = [(commit, old) for commit, old in status_history(root) if old.get("current_phase") == st["current_phase"]]
    interval = []
    for record in history:
        if effective_state(record[1]) != "PLAN":
            break
        interval.append(record)
    if not interval:
        return git(root, "rev-parse", "HEAD") if history else st["phase_base_sha"]
    entry = interval[-1][0]
    before = history[len(interval):]
    if not before:
        return st["phase_base_sha"]
    return git(root, "rev-parse", f"{entry}^")


# ---------------------------------------------------------------- probe

def _read_meminfo() -> dict:
    info = {}
    try:
        for line in open("/proc/meminfo"):
            k, v = line.split(":", 1)
            info[k] = int(v.split()[0])  # kB
    except OSError:
        pass
    return info


def _cgroup_mem_limit_mb() -> int | None:
    for p in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            v = open(p).read().strip()
            if v.isdigit() and int(v) < (1 << 60):
                return int(v) // (1024 * 1024)
        except OSError:
            pass
    return None


def _version(cmd: list[str]) -> str | None:
    if not shutil.which(cmd[0]):
        return None
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return (out.stdout or out.stderr).strip().splitlines()[0] if (out.stdout or out.stderr) else "present"
    except Exception:
        return "present"


def _port_open(port: int) -> bool | None:
    try:
        with socket.socket() as s:
            s.settimeout(0.5)
            return s.connect_ex(("127.0.0.1", port)) == 0
    except OSError:
        return None  # restricted sandbox: unknown, never infer the owner's server is absent


def probe(root: str) -> dict:
    mem = _read_meminfo()
    ram = mem.get("MemTotal", 0) // 1024
    limit = _cgroup_mem_limit_mb()
    if limit:
        ram = min(ram, limit)
    usage = shutil.disk_usage(root)
    if os.environ.get("WAYLAND_DISPLAY") or os.environ.get("DISPLAY"):
        display = "native"
    elif shutil.which("xvfb-run") or shutil.which("Xvfb"):
        display = "headless"
    else:
        display = "none"
    missing = []
    if not shutil.which("pkg-config") or subprocess.run(
        ["pkg-config", "--exists", "webkit2gtk-4.1"], capture_output=True
    ).returncode != 0:
        missing.append("webkit2gtk-4.1 (pkg-config)")
    for tool in ("tauri-driver", "WebKitWebDriver", "cargo"):
        if not shutil.which(tool):
            missing.append(tool)
    if not shutil.which("xvfb-run"):
        missing.append("xvfb-run (headless native execution required)")
    env = {
        "os": platform.system().lower(),
        "arch": platform.machine(),
        "ram_mb": ram,
        "swap_mb": mem.get("SwapTotal", 0) // 1024,
        "cpu_count": len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 0),
        "free_disk_mb": usage.free // (1024 * 1024),
        "display_mode": display,
        "tauri_native_runner": "available" if not missing else "unavailable",
    }
    extra = {
        "tauri_native_runner_missing": missing,
        "available_ram_mb": mem.get("MemAvailable", 0) // 1024,
        "cgroup_mem_limit_mb": limit,
        "port_3000_in_use": _port_open(3000),
        "toolchains": {
            "node": _version(["node", "--version"]),
            "mise": _version(["mise", "--version"]),
            "npm": _version(["npm", "--version"]),
            "ruby": _version(["ruby", "--version"]),
            "cargo": _version(["cargo", "--version"]),
            "rustc": _version(["rustc", "--version"]),
            "python3": _version(["python3", "--version"]),
            "chromium": _version(["chromium", "--version"]) or _version(["google-chrome", "--version"]),
            "psql": _version(["psql", "--version"]),
        },
    }
    return {"execution_environment": env, "extra": extra}


# ---------------------------------------------------------------- validate

def load_status(root: str) -> dict:
    with open(os.path.join(root, "docs/refactor/status.json"), encoding="utf-8") as f:
        return json.load(f)


def validate(root: str, prospective: bool = False) -> dict:
    errors, warnings, info = [], [], []
    status_file = os.path.join(root, "docs/refactor/status.json")
    if not os.path.exists(status_file):
        return {"ok": False, "errors": ["docs/refactor/status.json is missing: run `reconstruct`, then `init`"], "warnings": [], "info": []}
    try:
        st = load_status(root)
    except json.JSONDecodeError as e:
        return {"ok": False, "errors": [f"status.json is not valid JSON: {e}"], "warnings": [], "info": []}

    if not isinstance(st, dict):
        return {"ok": False, "errors": ["status must be a JSON object"], "warnings": [], "info": []}
    for k, t in REQUIRED_KEYS.items():
        if k not in st:
            errors.append(f"missing key {k}")
        elif not isinstance(st[k], t) or (t is int and type(st[k]) is not int):
            errors.append(f"key {k} has wrong type {type(st[k]).__name__}")
    if not isinstance(st, dict):
        return {"ok": False, "errors": ["status must be a JSON object"], "warnings": [], "info": []}
    for k in set(st) - set(REQUIRED_KEYS):
        warnings.append(f"unknown key {k} (schema is owned by CONSTITUTION.md section 1)")
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "info": info}

    if st["campaign_branch"] != "feat/refactor-desktop-and-web":
        errors.append("campaign_branch differs from the constitution")
    if not 0 <= st["current_phase"] <= 12 or st["review_round"] < 0:
        errors.append("phase/review range invalid")
    if st["last_completed_phase"] is not None and not 0 <= st["last_completed_phase"] <= 12:
        errors.append("last_completed_phase range invalid")
    if st["campaign_version"] != 9:
        errors.append("campaign_version must be 9")
    if st["phase_state"] not in STATES:
        errors.append(f"phase_state {st['phase_state']!r} not in {sorted(STATES)}")
    for k in ENV_KEYS:
        if k not in st["execution_environment"]:
            errors.append(f"execution_environment.{k} missing")
    for k in ("ram_mb", "swap_mb", "cpu_count", "free_disk_mb"):
        value = st["execution_environment"].get(k)
        if type(value) is not int or value < 0:
            errors.append(f"execution_environment.{k} must be a nonnegative integer")
    if st["execution_environment"].get("display_mode") not in {"native", "headless", "none"}:
        errors.append("invalid display_mode")
    if st["execution_environment"].get("tauri_native_runner") not in {"available", "unavailable", "unknown"}:
        errors.append("invalid tauri_native_runner")
    if not st["next_action"].strip():
        errors.append("next_action is empty")
    for gate in st["pending_human_gates"]:
        if not isinstance(gate, dict) or type(gate.get("gate")) is not int or gate["gate"] not in range(1,6):
            errors.append("human gates must use constitution classes 1..5")
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "info": info}

    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD")
    head = git(root, "rev-parse", "HEAD")
    info.append(f"branch={branch} HEAD={head[:12]}")
    if branch != st["campaign_branch"]:
        errors.append(f"checked-out branch {branch!r} != campaign_branch {st['campaign_branch']!r}")

    for key in ("campaign_base_sha", "phase_base_sha", "head_sha"):
        sha = st[key]
        if not sha:
            errors.append(f"{key} is empty")
            continue
        if not full_commit(root, sha):
            errors.append(f"{key} {sha[:12]} is not a commit in this repository")
        elif not git_ok(root, "merge-base", "--is-ancestor", sha, "HEAD"):
            errors.append(f"{key} {sha[:12]} is not an ancestor of HEAD (lineage broken)")
    if st["campaign_base_sha"] and st["phase_base_sha"] and not errors:
        if not git_ok(root, "merge-base", "--is-ancestor", st["campaign_base_sha"], st["phase_base_sha"]):
            errors.append("campaign_base_sha is not an ancestor of phase_base_sha")

    n = st["current_phase"]
    try:
        all_phases(root)
    except ValueError as e:
        errors.append(str(e))
    pf = phase_file(root, n)
    if not pf:
        errors.append(f"no unique docs/refactor/phases/{n:02d}-*.md")
    else:
        actual = sha256(pf)
        if st["phase_contract_sha256"] != actual:
            errors.append(
                f"phase contract {os.path.relpath(pf, root)} sha256 {actual[:16]}… != status {st['phase_contract_sha256'][:16]}… "
                "(contract changed or status stale; a frozen contract may not be silently altered)"
            )

    state = st["phase_state"]
    guarded_state = effective_state(st)
    pp = plan_path(root, n)
    if guarded_state in {"DO", "CHECK", "ACT", "PASS"}:
        if not os.path.exists(pp):
            errors.append(f"phase_state {state} requires frozen plan {os.path.relpath(pp, root)}")
        elif st["frozen_plan_sha256"] != sha256(pp):
            errors.append("frozen plan sha256 does not match status.frozen_plan_sha256 (plan edited without re-freeze)")
    if guarded_state == "PLAN":
        if st["frozen_plan_sha256"] not in (None, ""):
            warnings.append("phase_state PLAN but frozen_plan_sha256 is set")
        anchor = planning_anchor(root, st)
        changed = git(root, "diff", "--name-only", f"{anchor}..HEAD", check=False).splitlines() + working_paths(root) if anchor else working_paths(root)
        prod = production_paths(changed)
        if prod:
            errors.append(f"production edits exist before the plan is frozen: {prod[:8]}")

    if guarded_state in {"CHECK", "ACT", "PASS"} and st["head_sha"]:
        changed = git(root, "diff", "--name-only", f"{st['head_sha']}..HEAD", check=False).splitlines() + working_paths(root)
        bad = [c for c in changed if not allowed_path(c, POST_CANDIDATE_ALLOWED)]
        if bad:
            errors.append(f"files changed after reviewed candidate head_sha: {bad[:8]} (candidate must be re-checked/re-reviewed)")

    if state == "BLOCKED":
        blocker = st["blocker"]
        if not isinstance(blocker, dict) or any(not blocker.get(key) for key in ("code", "detail", "evidence", "unblock", "resume_state")):
            errors.append("BLOCKED requires code/detail/evidence/unblock/resume_state in blocker")
        elif blocker["resume_state"] not in {"PLAN", "DO", "CHECK", "ACT"}:
            errors.append("blocker.resume_state must be PLAN, DO, CHECK or ACT")
    if state != "BLOCKED" and st["blocker"]:
        warnings.append("blocker is set but phase_state is not BLOCKED")
    if st["review_round"] > MAX_REVIEW_ROUNDS:
        errors.append(f"review_round {st['review_round']} exceeds cap {MAX_REVIEW_ROUNDS}: BLOCKED(review-cap)")

    tip = git(root, "rev-parse", "HEAD")
    if guarded_state in {"DO", "CHECK", "ACT", "PASS"}:
        frozen_errors = freeze_errors(root, n, st, tip)
        if frozen_errors and prospective and state == "DO":
            latest = next((old for _, old in status_history(root) if old.get("current_phase") == n), {})
            anchor = planning_anchor(root, st)
            changed = git(root, "diff", "--name-only", f"{anchor}..HEAD", check=False).splitlines() + working_paths(root)
            if effective_state(latest) == "PLAN" and not production_paths(changed):
                info.append("prospective freeze is ready; DO is authorized only after its commit")
            else:
                errors.extend(frozen_errors)
        else:
            errors.extend(frozen_errors)
    if n == 0 and st["phase_base_sha"] != st["campaign_base_sha"]:
        errors.append("Phase 00 base must equal campaign_base_sha")
    if n > 0:
        previous, _ = pass_checkpoint(root, n-1)
        if not previous or st["phase_base_sha"] != previous:
            errors.append("phase_base_sha must equal previous proven PASS checkpoint")
    if guarded_state == "ACT":
        errors.extend(linked_evidence(root, n, st, require_pass=False))
    if state == "PASS":
        errors.extend(act_errors(root, n, st, tip))
        errors.extend(linked_evidence(root, n, st))
        if st["last_completed_phase"] != n:
            errors.append("phase_state PASS requires last_completed_phase == current_phase")
        checkpoint, _ = pass_checkpoint(root, n)
        if not checkpoint:
            warnings.append("PASS transition is not committed yet; reconstruct will not advance")

    last = st["last_completed_phase"]
    if last is not None:
        for p in range(0, min(last, 12) + 1):
            if p == n and state == "PASS":
                continue  # prospective current transition; historical phases must be checkpointed
            ok, reasons = phase_proven(root, p)
            if not ok:
                errors.append(f"last_completed_phase={last} but phase {p} is unproven: {reasons}")
        expected_current = last if state == "PASS" else last + 1
        if n != expected_current:
            errors.append(f"current_phase {n} inconsistent with last_completed_phase {last} and state {state}")
    elif n != 0:
        errors.append("last_completed_phase is null but current_phase != 0")

    dirty = git(root, "status", "--porcelain", check=False)
    if dirty:
        info.append("working tree has uncommitted changes:\n" + dirty)

    if state in {"CHECK", "ACT"}:
        ok, why, candidate = gate_evidence(root, n)
        if not ok:
            warnings.append(f"phase gate has not passed: {why}")
        elif candidate != st["head_sha"]:
            errors.append("gate head differs from CHECK/ACT candidate")
    env_now = probe(root)["execution_environment"]
    drift = {k: (st["execution_environment"].get(k), env_now[k]) for k in ("arch", "cpu_count", "display_mode", "tauri_native_runner") if st["execution_environment"].get(k) != env_now[k]}
    ram_old = st["execution_environment"].get("ram_mb") or 0
    if ram_old and abs(ram_old - env_now["ram_mb"]) > 512:
        drift["ram_mb"] = (ram_old, env_now["ram_mb"])
    if drift:
        warnings.append(f"execution environment differs from status (run `set-env` and record it): {drift}")

    info.append(f"current_phase={n} state={state} review_round={st['review_round']} next_action={st['next_action']!r}")
    return {"ok": not errors, "errors": errors, "warnings": warnings, "info": info}


def reconstruct(root: str) -> dict:
    try:
        phases = all_phases(root)
    except ValueError as e:
        return {"ok": False, "error": str(e), "earliest_unproven_phase": 0, "proven_contiguous_phases": []}
    proven, earliest, details = [], None, {}
    for p in phases:
        ok, reasons = phase_proven(root, p)
        if ok and earliest is None:
            proven.append(p)
        else:
            details[p] = reasons
            if earliest is None:
                earliest = p
    return {
        "proven_contiguous_phases": proven,
        "earliest_unproven_phase": earliest,
        "earliest_unproven_reasons": details.get(earliest, []),
        "frozen_plan_present": bool(earliest is not None and os.path.exists(plan_path(root, earliest))),
        "pass_checkpoints": {p: pass_checkpoint(root, p)[0] for p in proven},
        "latest_unproven_snapshot_to_inspect": next(({"commit": commit, "status": st} for commit, st in status_history(root) if st.get("current_phase") == earliest), None),
        "note": "Completion is never inferred from file presence alone; verify the gate head and review against git history and record evidence in docs/refactor/execution/status-reconstruction.md.",
    }


def init(root: str, base: str) -> dict:
    status_file = os.path.join(root, "docs/refactor/status.json")
    if os.path.exists(status_file):
        raise SystemExit("status.json exists; refusing to overwrite. Use validate/reconstruct.")
    with open(os.path.join(root, "docs/refactor/status.template.json"), encoding="utf-8") as f:
        st = json.load(f)
    head = git(root, "rev-parse", "HEAD")
    if not full_commit(root, base) or not git_ok(root, "merge-base", "--is-ancestor", base, head):
        raise SystemExit("--base must be the verified full campaign base SHA and an ancestor of HEAD")
    st["campaign_base_sha"] = base
    st["phase_base_sha"] = base
    st["head_sha"] = st["head_sha"] or head
    st["phase_contract_sha256"] = sha256(phase_file(root, st["current_phase"]))
    st["execution_environment"] = probe(root)["execution_environment"]
    write_status(root, st)
    return st


def atomic_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".campaign-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def write_status(root: str, st: dict) -> None:
    atomic_text(os.path.join(root, "docs/refactor/status.json"), json.dumps(st, indent=2) + "\n")


def prepare_gate(root: str, n: int) -> dict:
    st = load_status(root)
    if st["current_phase"] != n or st["phase_state"] != "DO":
        raise ValueError("prepare-gate requires the current phase in DO")
    checked = validate(root)
    if not checked["ok"]:
        raise ValueError("invalid DO state: " + repr(checked["errors"]))
    if production_paths(git(root, "diff", "--name-only", "HEAD").splitlines()):
        raise ValueError("commit tracked production changes before preparing a candidate")
    for path in glob.glob(os.path.join(root, f"docs/refactor/execution/phase-{n}-gate-attempts/*/started.json")):
        with open(path, encoding="utf-8") as source:
            old = json.load(source)
        # Completed runners are no longer active; orphaned checkout workers still are.
        if os.path.exists(os.path.join(os.path.dirname(path), "result.json")):
            old = {**old, "state": "completed"}
        active = active_attempt(old)
        if active:
            raise ValueError(f"prior gate still active: {old['attempt_id']} processes={active}; monitor/stop only owned processes before retry")
    attempt = uuid.uuid4().hex
    head = git(root, "rev-parse", "HEAD")
    checkout = os.path.join(root, "tmp", "gates", f"phase-{n}-{attempt}")
    artifact_dir = os.path.join(root, f"docs/refactor/execution/phase-{n}-gate-attempts", attempt)
    snapshot = {**st, "head_sha": head}
    snapshot_text = json.dumps(snapshot, indent=2) + "\n"
    manifest = {"attempt_id": attempt, "phase": n, "head": head, "root": os.path.realpath(root),
                "checkout": checkout, "state": "prepared", "started_ns": time.time_ns(),
                "status_sha256": digest(snapshot_text),
                "frozen_plan_sha256": st["frozen_plan_sha256"], "phase_contract_sha256": st["phase_contract_sha256"]}
    # The manifest owns this path even if a worktree creation is interrupted.
    atomic_text(os.path.join(artifact_dir, "started.json"), json.dumps(manifest, indent=2) + "\n")
    atomic_text(os.path.join(artifact_dir, "status.json"), snapshot_text)
    git(root, "worktree", "add", "--detach", checkout, head)
    return manifest


def owned_gate(root: str, n: int, attempt: str) -> tuple[str, dict]:
    if not re.fullmatch(r"[0-9a-f]{32}", attempt):
        raise ValueError("invalid gate attempt ID")
    directory = os.path.join(root, f"docs/refactor/execution/phase-{n}-gate-attempts", attempt)
    manifest = json.loads(read_text(root, os.path.relpath(os.path.join(directory, "started.json"), root)))
    expected = os.path.join(root, "tmp", "gates", f"phase-{n}-{attempt}")
    if manifest.get("root") != os.path.realpath(root) or manifest.get("checkout") != expected or manifest.get("phase") != n or manifest.get("attempt_id") != attempt:
        raise ValueError("gate ownership metadata differs")
    return directory, manifest


def cleanup_gate(root: str, n: int, attempt: str) -> None:
    directory, manifest = owned_gate(root, n, attempt)
    if os.path.exists(os.path.join(directory, "result.json")):
        manifest = {**manifest, "state": "completed"}
    active = active_attempt(manifest)
    if active:
        raise ValueError(f"gate still active: processes={active}; preserve its worktree")
    checkout = manifest["checkout"]
    if not os.path.exists(checkout):
        return
    if git(checkout, "rev-parse", "--show-toplevel") != checkout or git(checkout, "rev-parse", "HEAD") != manifest["head"]:
        raise ValueError("gate worktree identity changed; preserved")
    if git(checkout, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("gate worktree is dirty; preserved")
    git(root, "worktree", "remove", checkout)


def run_gate(root: str, n: int, attempt: str | None = None) -> int:
    if attempt is None:
        attempt = prepare_gate(root, n)["attempt_id"]
    directory, manifest = owned_gate(root, n, attempt)
    if os.path.exists(os.path.join(directory, "result.json")) or manifest["state"] != "prepared":
        raise ValueError("gate attempt already ran or was interrupted; preserve it and prepare a new attempt")
    st = load_status(root)
    if st["phase_state"] != "DO" or st["current_phase"] != n or any(manifest[key] != st[key] for key in ("frozen_plan_sha256", "phase_contract_sha256")):
        raise ValueError("gate attempt no longer matches DO phase/plan/contract")
    checkout, head = manifest["checkout"], manifest["head"]
    if git(root, "rev-parse", "HEAD") != head or git(checkout, "rev-parse", "HEAD") != head:
        raise ValueError("candidate changed since gate preparation")
    if git(checkout, "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("gate worktree has tracked or untracked inputs absent from the candidate")
    if checkout_processes(checkout):
        raise ValueError("gate checkout still has active setup/checker processes")
    snapshot_path = os.path.join(directory, "status.json")
    if sha256(snapshot_path) != manifest["status_sha256"]:
        raise ValueError("prepared gate status snapshot changed")
    manifest.update(state="running", runner_pid=os.getpid(), runner_start=process_start(os.getpid()))
    atomic_text(os.path.join(directory, "started.json"), json.dumps(manifest, indent=2) + "\n")
    started = time.monotonic()
    env = os.environ.copy()
    env["ELEF_GATE_EVIDENCE_DIR"] = os.path.join(root, "docs/refactor/execution")
    env["ELEF_GATE_STATUS_PATH"] = snapshot_path
    stdout_path, stderr_path = os.path.join(directory, "stdout.txt"), os.path.join(directory, "stderr.log")
    try:
        with open(stdout_path, "w", encoding="utf-8") as stdout, open(stderr_path, "w", encoding="utf-8") as stderr:
            process = subprocess.Popen([os.path.join(checkout, "bin/check"), "phase", str(n), "--json"], cwd=checkout, stdout=stdout, stderr=stderr, env=env, start_new_session=True)
            manifest.update(child_pid=process.pid, child_start=process_start(process.pid))
            atomic_text(os.path.join(directory, "started.json"), json.dumps(manifest, indent=2) + "\n")
            exit_code = process.wait()
        dirty = git(checkout, "status", "--porcelain", "--untracked-files=all")
        if dirty:
            exit_code = 1
            with open(stderr_path, "a", encoding="utf-8") as stderr:
                stderr.write("\ngate changed tracked/nonignored inputs; candidate verification is invalid:\n" + dirty + "\n")
        if sha256(snapshot_path) != manifest["status_sha256"]:
            exit_code = 1
            with open(stderr_path, "a", encoding="utf-8") as stderr:
                stderr.write("\ngate changed its immutable status snapshot; verification is invalid\n")
        result = {**manifest, "state": "completed", "command": f"bin/check phase {n} --json", "exit": exit_code,
                  "duration_s": round(time.monotonic()-started, 3), "tier": "phase", "stdout_sha256": sha256(stdout_path),
                  "stderr_sha256": sha256(stderr_path)}
        atomic_text(os.path.join(directory, "result.json"), json.dumps(result, indent=2) + "\n")
        # One atomic pointer selects a complete attempt; retries never overwrite attempt logs.
        atomic_text(os.path.join(root, f"docs/refactor/execution/phase-{n}-gate.json"), json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        return exit_code if exit_code > 0 else (1 if exit_code < 0 else 0)
    except OSError as error:
        manifest.update(state="interrupted", error=str(error))
        atomic_text(os.path.join(directory, "started.json"), json.dumps(manifest, indent=2) + "\n")
        raise



def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    v = sub.add_parser("validate")
    v.add_argument("--json", action="store_true")
    v.add_argument("--prospective", action="store_true", help="validate a pending freeze before commit; never authorizes production")
    sub.add_parser("reconstruct")
    init_parser = sub.add_parser("init")
    init_parser.add_argument("--base", required=True)
    gate_parser = sub.add_parser("run-gate")
    gate_parser.add_argument("phase", type=int, choices=range(13))
    gate_parser.add_argument("--attempt")
    prepare_parser = sub.add_parser("prepare-gate")
    prepare_parser.add_argument("phase", type=int, choices=range(13))
    cleanup_parser = sub.add_parser("cleanup-gate")
    cleanup_parser.add_argument("phase", type=int, choices=range(13))
    cleanup_parser.add_argument("attempt")
    s = sub.add_parser("sha256")
    s.add_argument("path")
    sub.add_parser("set-env")
    a = ap.parse_args()
    root = a.root or subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    if not root:
        print("not inside a git checkout", file=sys.stderr)
        return 2
    root = os.path.realpath(root)

    if a.cmd == "probe":
        print(json.dumps(probe(root), indent=2))
    elif a.cmd == "sha256":
        print(sha256(a.path))
    elif a.cmd == "init":
        print(json.dumps(init(root, a.base), indent=2))
    elif a.cmd == "prepare-gate":
        print(json.dumps(prepare_gate(root, a.phase), indent=2))
    elif a.cmd == "cleanup-gate":
        cleanup_gate(root, a.phase, a.attempt)
    elif a.cmd == "run-gate":
        return run_gate(root, a.phase, a.attempt)
    elif a.cmd == "set-env":
        st = load_status(root)
        st["execution_environment"] = probe(root)["execution_environment"]
        write_status(root, st)
        print(json.dumps(st["execution_environment"], indent=2))
    elif a.cmd == "reconstruct":
        result = reconstruct(root)
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok", True) else 1
    elif a.cmd == "validate":
        r = validate(root, a.prospective)
        if a.json:
            print(json.dumps(r, indent=2))
        else:
            for e in r["errors"]:
                print(f"ERROR   {e}")
            for w in r["warnings"]:
                print(f"WARN    {w}")
            for i in r["info"]:
                print(f"INFO    {i}")
            print("STATUS_VALID" if r["ok"] else "STATUS_INVALID")
        return 0 if r["ok"] else 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
