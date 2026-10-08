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
  R6  package dependencies point one way and stay host-free: work-model
      imports only its own barrel subpaths (bare self-reference keeps the
      browser-loaded barrel free of relative imports); renderer imports
      only relative sources, @elef/work-model, and its pinned markdown
      vendor modules.
  R7  package sources stay pure: no DOM/host-environment tokens in
      work-model, no editor-chrome tokens in renderer.
  R8  Ruby and Rust do not reinterpret Work syntax: no renderer, parser or
      fence-scan literals in app/lib, crates or desktop/src-tauri, except
      the single delegating slide-range wrapper.
  R9  the interactive client is host-free (P04-05): packages/client/src
      imports only relative sources, react, and @elef packages, and
      carries no host token (__TAURI__, MiniRacer, ActiveRecord, tauri,
      rails, __ELEF_E2E__).
  R10 client features stay isolated and acyclic (P04-06): no imports
      across features/ subdirectories, ui/ imports neither features/ nor
      application/, and the relative-import graph has no cycle.
  R11 product settings styles have one owner (P05-04): exactly one
      *settings*.css exists outside generated, vendored, staged and
      review checkouts (the shared application.css partial both hosts
      compile); a second settings stylesheet is a duplicate owner.

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
    public = {path.parent.parent.name for path in PACKAGES.glob("*/src/index.*")}
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


RENDERER_ALLOWED_BARE = (
    "@elef/work-model",
    "markdown-it",
    "highlight.js",
    "katex",
)

WORK_MODEL_ENV_PATTERN = re.compile(
    r"document\.|window\.|from \"react\"|__TAURI__|node:|process\.env|MiniRacer"
)
CLIENT_ALLOWED_BARE = (
    "react",
    "react-dom",
    "@elef/client",
    "@elef/contracts",
    "@elef/renderer",
    "@elef/work-model",
)
CLIENT_HOST_PATTERN = re.compile(
    r"__TAURI__|MiniRacer|ActiveRecord|__ELEF_E2E__|\btauri\b|\brails\b",
    re.IGNORECASE,
)
RENDERER_CHROME_PATTERN = re.compile(
    r"data-action|data-controller|contenteditable|<button|<select|Stimulus"
    r"|presentation-editor|visual-editor|media#"
)
REINTERPRET_PATTERN = re.compile(
    r"Redcarpet|Rouge|ELEF_RENDERER|parse_margin|parse_blocks|protect_math"
    r"|fence_marker|toggle_fence|display_math_fence|markdown_blocks|split_sections"
)
RANGE_WRAPPER_ALLOW = re.compile(r"^\s*def slide_source_ranges")


def package_sources(package: str) -> list[Path]:
    root = PACKAGES / package / "src"
    if not root.is_dir():
        return []
    return sorted(p for p in root.rglob("*.js") if "node_modules" not in p.parts)


def check_package_direction() -> list[str]:
    violations = []
    for source in package_sources("work-model"):
        for specifier in specifiers(source):
            if specifier.startswith("."):
                target = (source.parent / specifier).resolve()
                try:
                    target.relative_to(PACKAGES / "work-model")
                except ValueError:
                    violations.append(
                        f"R6 work-model escapes its package: {source.relative_to(ROOT)} -> {specifier}"
                    )
                continue
            if specifier.startswith("@elef/work-model/"):
                continue
            violations.append(
                f"R6 work-model imports executable {specifier!r}: {source.relative_to(ROOT)}"
            )
    for source in package_sources("renderer"):
        for specifier in specifiers(source):
            if specifier.startswith("."):
                target = (source.parent / specifier).resolve()
                try:
                    target.relative_to(PACKAGES / "renderer")
                except ValueError:
                    violations.append(
                        f"R6 renderer escapes its package: {source.relative_to(ROOT)} -> {specifier}"
                    )
                continue
            if specifier == "@elef/work-model" or any(
                specifier == allowed or specifier.startswith(f"{allowed}/")
                for allowed in RENDERER_ALLOWED_BARE[1:]
            ):
                continue
            violations.append(
                f"R6 renderer imports non-vendor {specifier!r}: {source.relative_to(ROOT)}"
            )
    return violations


def check_package_purity() -> list[str]:
    violations = []
    for source in package_sources("work-model"):
        if WORK_MODEL_ENV_PATTERN.search(source.read_text()):
            violations.append(f"R7 work-model binds a host environment: {source.relative_to(ROOT)}")
    for source in package_sources("renderer"):
        if RENDERER_CHROME_PATTERN.search(source.read_text()):
            violations.append(f"R7 renderer carries editor chrome: {source.relative_to(ROOT)}")
    return violations


def client_sources() -> list[Path]:
    root = PACKAGES / "client" / "src"
    if not root.is_dir():
        return []
    return sorted(
        p
        for p in list(root.rglob("*.ts")) + list(root.rglob("*.tsx")) + list(root.rglob("*.js"))
        if "node_modules" not in p.parts and p.suffix != ".d.ts" and not p.name.endswith(".d.ts")
    )


def check_client_host_free() -> list[str]:
    violations = []
    for source in client_sources():
        text = source.read_text()
        for specifier in specifiers(source):
            if specifier.startswith("."):
                target = (source.parent / specifier).resolve()
                try:
                    target.relative_to(PACKAGES / "client")
                except ValueError:
                    violations.append(
                        f"R9 client escapes its package: {source.relative_to(ROOT)} -> {specifier}"
                    )
                continue
            if any(specifier == allowed or specifier.startswith(f"{allowed}/") for allowed in CLIENT_ALLOWED_BARE):
                continue
            violations.append(
                f"R9 client imports host-external {specifier!r}: {source.relative_to(ROOT)}"
            )
        match = CLIENT_HOST_PATTERN.search(text)
        if match:
            violations.append(
                f"R9 client carries host token {match.group(0)!r}: {source.relative_to(ROOT)}"
            )
    return violations


def resolve_client_module(source: Path, specifier: str) -> Path | None:
    base = source.parent / specifier
    candidates = [base]
    if base.suffix == ".js":
        stem = base.with_suffix("")
        candidates = [stem.with_suffix(".ts"), stem.with_suffix(".tsx"), base]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def check_client_isolation() -> list[str]:
    violations = []
    src = PACKAGES / "client" / "src"
    graph: dict[Path, list[Path]] = {}
    for source in client_sources():
        try:
            relative = source.relative_to(src)
        except ValueError:
            continue
        own_feature = relative.parts[1] if len(relative.parts) > 1 and relative.parts[0] == "features" else None
        targets = []
        for specifier in specifiers(source):
            if not specifier.startswith("."):
                continue
            target = resolve_client_module(source, specifier)
            if target is None:
                continue
            try:
                target_relative = target.relative_to(src)
            except ValueError:
                continue
            targets.append(target)
            if own_feature is not None and len(target_relative.parts) > 1 and target_relative.parts[0] == "features":
                if target_relative.parts[1] != own_feature:
                    violations.append(
                        f"R10 client feature {own_feature} reaches {target_relative.parts[1]}: {source.relative_to(ROOT)}"
                    )
            if relative.parts[0] == "ui" and target_relative.parts[0] in {"features", "application"}:
                violations.append(
                    f"R10 client ui reaches {target_relative.parts[0]}: {source.relative_to(ROOT)}"
                )
        graph[source.resolve()] = targets
    visiting: set[Path] = set()
    visited: set[Path] = set()
    stack: list[Path] = []

    def visit(node: Path) -> None:
        if node in visited:
            return
        if node in visiting:
            cycle = stack[stack.index(node):] + [node]
            violations.append(
                "R10 client import cycle: " + " -> ".join(p.relative_to(src).as_posix() for p in cycle)
            )
            return
        visiting.add(node)
        stack.append(node)
        for target in graph.get(node, []):
            visit(target)
        stack.pop()
        visiting.discard(node)
        visited.add(node)

    for node in sorted(graph):
        visit(node)
    return violations


SETTINGS_STYLESHEET_OWNER = Path("app/assets/stylesheets/components/settings.css")

# Directory names that never hold a styles owner: generated bundles,
# vendored code, staged canary fixtures, and disposable review/gate
# checkouts (which duplicate the whole tree, owner included).
SETTINGS_STYLE_EXCLUDED_PARTS = frozenset(
    {"node_modules", "dist", "dist-e2e", "builds", "tmp", ".git", "canary"}
)


def check_settings_styles() -> list[str]:
    violations = []
    found = sorted(
        str(path.relative_to(ROOT))
        for path in ROOT.rglob("*settings*.css")
        if path.is_file() and SETTINGS_STYLE_EXCLUDED_PARTS.isdisjoint(path.parts)
    )
    if found != [SETTINGS_STYLESHEET_OWNER.as_posix()]:
        violations.append(
            "R11 settings styles must live only in "
            f"{SETTINGS_STYLESHEET_OWNER.as_posix()}: found {found}"
        )
    return violations


def check_no_reinterpretation() -> list[str]:
    violations = []
    scopes = [ROOT / "app" / "lib", ROOT / "crates", ROOT / "desktop" / "src-tauri"]
    for scope in scopes:
        if not scope.is_dir():
            continue
        for source in sorted(scope.rglob("*")):
            if not source.is_file() or source.suffix not in {".rb", ".rs", ".js", ".ts"}:
                continue
            try:
                text = source.read_text()
            except (OSError, UnicodeDecodeError):
                continue
            for number, line in enumerate(text.splitlines(), start=1):
                if not REINTERPRET_PATTERN.search(line):
                    continue
                if (
                    source == ROOT / "app" / "lib" / "source" / "document.rb"
                    and RANGE_WRAPPER_ALLOW.match(line)
                ):
                    continue
                violations.append(
                    f"R8 Work syntax reinterpreted: {source.relative_to(ROOT)}:{number}"
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
        + check_package_direction()
        + check_package_purity()
        + check_no_reinterpretation()
        + check_client_host_free()
        + check_client_isolation()
        + check_settings_styles()
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
        shutil.copytree(ROOT / "app" / "lib", stage / "app" / "lib")
        shutil.copytree(
            ROOT / "app" / "assets" / "stylesheets",
            stage / "app" / "assets" / "stylesheets",
        )
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
    expected = {"R1", "R2", "R4", "R6", "R7", "R8", "R9", "R10", "R11"}
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
    print("Architecture boundaries hold: contracts pure, no deep imports, local-store Tauri-free, adapters transport-injected, packages directed and pure, no Work reinterpretation, client host-free and isolated, settings styles single-owned.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
