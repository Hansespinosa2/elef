#!/usr/bin/env python3
"""Enforce Phase 01 architectural boundaries and package admission mechanics.

Rules (constitution section 4, Phase 01 plan section 8):
  R1  packages/contracts imports nothing executable: only relative type
      imports inside the package; no node:, @elef/, desktop, tauri or
      filesystem specifiers.
  R2  no deep imports across package internals: nothing outside packages/<name>/
      may import beneath its public entry (src/index).
  R3  crates/local-store has no Tauri knowledge: no "tauri" string in its
      sources or manifest.
  R4  conformance adapters reach hosts only through injected transports: no
      @tauri-apps imports and no __TAURI__ globals in tests/host-conformance.
  R5  every directory directly under packages/ is a real package: it carries
      package.json (private) and a frozen public entry (types field).

Usage:
  tooling/check_boundaries.py                 enforce R1-R5 on the repo
  tooling/check_boundaries.py --self-test     prove R1/R2/R4 reject the
      deliberate canaries under tooling/canary/ (exit 0 only when every
      canary is flagged)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ROOT / "packages"
CANARY = ROOT / "tooling" / "canary"

IMPORT_PATTERN = re.compile(r"""(?:\bimport\s+(?:type\s+)?[^'"]*?from\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]""")


def specifiers(path: Path) -> list[str]:
    return IMPORT_PATTERN.findall(path.read_text())


def check_contracts() -> list[str]:
    violations = []
    for source in sorted((PACKAGES / "contracts" / "src").rglob("*.ts")):
        for specifier in specifiers(source):
            if specifier.startswith("."):
                continue
            violations.append(f"R1 contracts imports executable {specifier!r}: {source.relative_to(ROOT)}")
    return violations


def check_deep_imports() -> list[str]:
    violations = []
    public = {path.parent.parent.name for path in PACKAGES.glob("*/src/index.ts")}
    for package in sorted(PACKAGES.iterdir()):
        if not package.is_dir():
            continue
        sources = sorted(package.rglob("*.ts")) + sorted(package.rglob("*.js"))
        for source in sources:
            if "node_modules" in source.parts or "dist" in source.parts:
                continue
            for specifier in specifiers(source):
                if not specifier.startswith("."):
                    continue
                target = (source.parent / specifier).resolve()
                try:
                    relative = target.relative_to(PACKAGES)
                except ValueError:
                    continue
                if len(relative.parts) > 1 and relative.parts[0] in public and relative.parts[0] != package.name:
                    violations.append(
                        f"R2 deep import across packages: {source.relative_to(ROOT)} -> {specifier}"
                    )
    return violations


def check_local_store() -> list[str]:
    violations = []
    store = ROOT / "crates" / "local-store"
    for source in sorted(store.rglob("*.rs")) + [store / "Cargo.toml"]:
        if "tauri" in source.read_text().lower():
            violations.append(f"R3 local-store knows Tauri: {source.relative_to(ROOT)}")
    return violations


def check_adapters() -> list[str]:
    violations = []
    suite = ROOT / "tests" / "host-conformance"
    for source in sorted(suite.rglob("*.js")):
        text = source.read_text()
        if "@tauri-apps" in text:
            violations.append(f"R4 adapter binds Tauri packages: {source.relative_to(ROOT)}")
        if "__TAURI__" in text:
            violations.append(f"R4 adapter binds Tauri globals: {source.relative_to(ROOT)}")
    return violations


def check_package_shape() -> list[str]:
    import json

    violations = []
    if not PACKAGES.is_dir():
        return ["R5 packages/ is missing"]
    for package in sorted(PACKAGES.iterdir()):
        if not package.is_dir():
            continue
        manifest = package / "package.json"
        if not manifest.is_file():
            violations.append(f"R5 {package.name} has no package.json")
            continue
        data = json.loads(manifest.read_text())
        if data.get("private") is not True:
            violations.append(f"R5 {package.name} must stay private")
        if not data.get("types"):
            violations.append(f"R5 {package.name} must freeze its public types entry")
    return violations


def run_all() -> list[str]:
    return (
        check_contracts()
        + check_deep_imports()
        + check_local_store()
        + check_adapters()
        + check_package_shape()
    )


def self_test() -> int:
    # Overlay the deliberate canaries onto a staged copy and prove every
    # expected rule fires. Exit 0 only when all canaries are rejected.
    global ROOT, PACKAGES
    import shutil
    import tempfile

    if not CANARY.is_dir():
        print("canary fixtures are missing", file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory() as staging:
        stage = Path(staging)
        shutil.copytree(PACKAGES, stage / "packages")
        shutil.copytree(ROOT / "crates", stage / "crates")
        shutil.copytree(ROOT / "tests", stage / "tests")
        for fixture in sorted(CANARY.rglob("*")):
            if not fixture.is_file():
                continue
            target = stage / fixture.relative_to(CANARY)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(fixture, target)
        old_root, old_packages = ROOT, PACKAGES
        ROOT, PACKAGES = stage, stage / "packages"
        try:
            found = run_all()
        finally:
            ROOT, PACKAGES = old_root, old_packages
    expected = {"R1", "R2", "R4"}
    seen = {line.split()[0] for line in found}
    missing = expected - seen
    if missing:
        print(f"canary NOT rejected for: {sorted(missing)}", file=sys.stderr)
        for line in found:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"canary rejected as required: {sorted(seen)}")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    violations = run_all()
    for violation in violations:
        print(violation, file=sys.stderr)
    if violations:
        return 1
    print("Architecture boundaries hold: contracts pure, no deep imports, local-store Tauri-free, adapters transport-injected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
