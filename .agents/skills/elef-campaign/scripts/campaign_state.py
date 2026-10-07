#!/usr/bin/env python3
"""Deterministic helper for the Elef refactor campaign state.

Workflow tooling only. The schema and rules it checks are owned by
docs/refactor/CONSTITUTION.md (section 1); this script never decides PASS.

Commands (run from anywhere inside the checkout):
  probe                     print the execution_environment object + extra facts
  validate [--json]         check status.json against git and evidence; exit 1 on errors
  reconstruct               report the earliest phase whose PASS cannot be proven
  init                      create status.json from status.template.json (refuses to overwrite)
  sha256 PATH               print the SHA-256 of a file
  set-env                   rewrite execution_environment in status.json from a fresh probe

Global option: --root PATH (defaults to the git toplevel); useful for disposable fixtures.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys

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
    nums = []
    for p in glob.glob(os.path.join(root, "docs/refactor/phases", "[0-9][0-9]-*.md")):
        nums.append(int(os.path.basename(p)[:2]))
    return sorted(set(nums))


def plan_path(root: str, n: int) -> str:
    return os.path.join(root, "docs/refactor/execution", f"phase-{n}-plan.md")


def gate_path(root: str, n: int) -> str:
    return os.path.join(root, "docs/refactor/execution", f"phase-{n}-gate.txt")


def latest_review(root: str, n: int) -> tuple[int, str] | None:
    best = None
    for p in glob.glob(os.path.join(root, "docs/refactor/reviews", f"phase-{n}-round-*.md")):
        m = re.search(r"round-(\d+)\.md$", p)
        if m and (best is None or int(m.group(1)) > best[0]):
            best = (int(m.group(1)), p)
    return best


def review_result(path: str) -> str | None:
    result = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^\s*\**Result:?\**:?\s*\**\s*(PASS|FAIL|BLOCKED(\([^)]*\))?)", line)
            if m:
                result = m.group(1)
    return result


def gate_evidence(root: str, n: int) -> tuple[bool, str, str | None]:
    """Return (ok, reason, head) for the stored `bin/check phase N --json` stdout."""
    p = gate_path(root, n)
    if not os.path.exists(p):
        return False, f"missing {os.path.relpath(p, root)}", None
    text = open(p, encoding="utf-8").read()
    markers = [l for l in text.splitlines() if l.strip() == f"ELEF_PHASE_{n}=PASS"]
    if len(markers) != 1:
        return False, f"expected exactly one line ELEF_PHASE_{n}=PASS, found {len(markers)}", None
    head = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("phase") == n and obj.get("result") == "PASS":
                head = obj.get("head")
    if not head:
        return False, 'no JSON line {"phase":N,"result":"PASS","head":...}', None
    return True, "ok", head


def phase_proven(root: str, n: int) -> tuple[bool, list[str]]:
    reasons = []
    ok, why, head = gate_evidence(root, n)
    if not ok:
        reasons.append(f"gate: {why}")
    rev = latest_review(root, n)
    if not rev:
        reasons.append("review: no docs/refactor/reviews/phase-%d-round-K.md" % n)
    else:
        res = review_result(rev[1])
        if res != "PASS":
            reasons.append(f"review: latest round {rev[0]} result is {res!r}, not PASS")
    if head and not git_ok(root, "merge-base", "--is-ancestor", head, "HEAD"):
        reasons.append(f"gate head {head[:12]} is not an ancestor of HEAD")
    return (not reasons), reasons


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


def _port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


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
    if not _version(["pkg-config", "--modversion", "webkit2gtk-4.1"]) or subprocess.run(
        ["pkg-config", "--exists", "webkit2gtk-4.1"], capture_output=True
    ).returncode != 0:
        missing.append("webkit2gtk-4.1 (pkg-config)")
    for tool in ("tauri-driver", "WebKitWebDriver", "cargo"):
        if not shutil.which(tool):
            missing.append(tool)
    if display == "none":
        missing.append("display (WAYLAND_DISPLAY/DISPLAY) or xvfb-run")
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
            "node22_via_mise": _version(["mise", "exec", "node@22", "--", "node", "--version"]) if shutil.which("mise") else None,
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


def validate(root: str) -> dict:
    errors, warnings, info = [], [], []
    status_file = os.path.join(root, "docs/refactor/status.json")
    if not os.path.exists(status_file):
        return {"ok": False, "errors": ["docs/refactor/status.json is missing: run `reconstruct`, then `init`"], "warnings": [], "info": []}
    try:
        st = load_status(root)
    except json.JSONDecodeError as e:
        return {"ok": False, "errors": [f"status.json is not valid JSON: {e}"], "warnings": [], "info": []}

    for k, t in REQUIRED_KEYS.items():
        if k not in st:
            errors.append(f"missing key {k}")
        elif not isinstance(st[k], t):
            errors.append(f"key {k} has wrong type {type(st[k]).__name__}")
    for k in set(st) - set(REQUIRED_KEYS):
        warnings.append(f"unknown key {k} (schema is owned by CONSTITUTION.md section 1)")
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings, "info": info}

    if st["campaign_version"] != 9:
        errors.append("campaign_version must be 9")
    if st["phase_state"] not in STATES:
        errors.append(f"phase_state {st['phase_state']!r} not in {sorted(STATES)}")
    for k in ENV_KEYS:
        if k not in st["execution_environment"]:
            errors.append(f"execution_environment.{k} missing")

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
        if not git_ok(root, "cat-file", "-e", f"{sha}^{{commit}}"):
            errors.append(f"{key} {sha[:12]} is not a commit in this repository")
        elif not git_ok(root, "merge-base", "--is-ancestor", sha, "HEAD"):
            errors.append(f"{key} {sha[:12]} is not an ancestor of HEAD (lineage broken)")
    if st["campaign_base_sha"] and st["phase_base_sha"] and not errors:
        if not git_ok(root, "merge-base", "--is-ancestor", st["campaign_base_sha"], st["phase_base_sha"]):
            errors.append("campaign_base_sha is not an ancestor of phase_base_sha")

    n = st["current_phase"]
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
    pp = plan_path(root, n)
    if state in {"DO", "CHECK", "ACT", "PASS"}:
        if not os.path.exists(pp):
            errors.append(f"phase_state {state} requires frozen plan {os.path.relpath(pp, root)}")
        elif st["frozen_plan_sha256"] != sha256(pp):
            errors.append("frozen plan sha256 does not match status.frozen_plan_sha256 (plan edited without re-freeze)")
    if state == "PLAN":
        if st["frozen_plan_sha256"] not in (None, ""):
            warnings.append("phase_state PLAN but frozen_plan_sha256 is set")
        changed = git(root, "diff", "--name-only", f"{st['phase_base_sha']}..HEAD", check=False).splitlines() if st["phase_base_sha"] else []
        prod = [c for c in changed if not c.startswith(("docs/refactor/", ".agents/", "AGENTS.md", "CLAUDE.md", ".claude/"))]
        if prod:
            errors.append(f"production edits exist before the plan is frozen: {prod[:8]}")

    if state in {"CHECK", "ACT", "PASS"} and st["head_sha"]:
        changed = git(root, "diff", "--name-only", f"{st['head_sha']}..HEAD", check=False).splitlines()
        bad = [c for c in changed if not c.startswith(POST_CANDIDATE_ALLOWED)]
        if bad:
            errors.append(f"files changed after reviewed candidate head_sha: {bad[:8]} (candidate must be re-checked/re-reviewed)")

    if state == "BLOCKED" and not st["blocker"]:
        errors.append("phase_state BLOCKED requires a blocker")
    if state != "BLOCKED" and st["blocker"]:
        warnings.append("blocker is set but phase_state is not BLOCKED")
    if st["review_round"] > MAX_REVIEW_ROUNDS:
        errors.append(f"review_round {st['review_round']} exceeds cap {MAX_REVIEW_ROUNDS}: BLOCKED(review-cap)")

    if state == "PASS":
        ok, reasons = phase_proven(root, n)
        if not ok:
            errors.append(f"phase {n} marked PASS but unproven: {reasons}")
        _, _, gate_head = gate_evidence(root, n)
        if gate_head and st["head_sha"] and not gate_head.startswith(st["head_sha"]) and not st["head_sha"].startswith(gate_head):
            errors.append(f"gate head {gate_head[:12]} != status head_sha {st['head_sha'][:12]} (PASS must cite the reviewed candidate)")
        if st["last_completed_phase"] != n:
            errors.append("phase_state PASS requires last_completed_phase == current_phase")

    last = st["last_completed_phase"]
    if last is not None:
        for p in range(0, last + 1):
            ok, reasons = phase_proven(root, p)
            if not ok:
                errors.append(f"last_completed_phase={last} but phase {p} is unproven: {reasons}")
        expected_current = last if state == "PASS" else last + 1
        if n != expected_current and state != "BLOCKED":
            errors.append(f"current_phase {n} inconsistent with last_completed_phase {last} and state {state}")
    elif n != 0:
        errors.append("last_completed_phase is null but current_phase != 0")

    dirty = git(root, "status", "--porcelain", check=False)
    if dirty:
        info.append("working tree has uncommitted changes:\n" + dirty)

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
    phases = all_phases(root)
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
        "note": "Completion is never inferred from file presence alone; verify the gate head and review against git history and record evidence in docs/refactor/execution/status-reconstruction.md.",
    }


def init(root: str) -> dict:
    status_file = os.path.join(root, "docs/refactor/status.json")
    if os.path.exists(status_file):
        raise SystemExit("status.json exists; refusing to overwrite. Use validate/reconstruct.")
    with open(os.path.join(root, "docs/refactor/status.template.json"), encoding="utf-8") as f:
        st = json.load(f)
    head = git(root, "rev-parse", "HEAD")
    st["campaign_base_sha"] = st["campaign_base_sha"] or head
    st["phase_base_sha"] = st["phase_base_sha"] or head
    st["head_sha"] = st["head_sha"] or head
    st["phase_contract_sha256"] = sha256(phase_file(root, st["current_phase"]))
    st["execution_environment"] = probe(root)["execution_environment"]
    write_status(root, st)
    return st


def write_status(root: str, st: dict) -> None:
    with open(os.path.join(root, "docs/refactor/status.json"), "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)
        f.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    v = sub.add_parser("validate")
    v.add_argument("--json", action="store_true")
    sub.add_parser("reconstruct")
    sub.add_parser("init")
    s = sub.add_parser("sha256")
    s.add_argument("path")
    sub.add_parser("set-env")
    a = ap.parse_args()
    root = a.root or subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    if not root:
        print("not inside a git checkout", file=sys.stderr)
        return 2

    if a.cmd == "probe":
        print(json.dumps(probe(root), indent=2))
    elif a.cmd == "sha256":
        print(sha256(a.path))
    elif a.cmd == "init":
        print(json.dumps(init(root), indent=2))
    elif a.cmd == "set-env":
        st = load_status(root)
        st["execution_environment"] = probe(root)["execution_environment"]
        write_status(root, st)
        print(json.dumps(st["execution_environment"], indent=2))
    elif a.cmd == "reconstruct":
        print(json.dumps(reconstruct(root), indent=2))
    elif a.cmd == "validate":
        r = validate(root)
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
    sys.exit(main())
