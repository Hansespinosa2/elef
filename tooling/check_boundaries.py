#!/usr/bin/env python3
"""Enforce Phase 01 architectural boundaries and package admission mechanics.

Rules (constitution section 4, Phase 01 plan section 8):
  R1  packages/contracts imports nothing executable: only relative type
      imports inside the package; no node:, @elef/, desktop, tauri or
      filesystem specifiers.
  R2  no deep imports across package internals: nothing outside packages/<name>/
      may import beneath its public entry (src/index). Enforced repo-wide:
      packages, both hosts, apps/web/test, apps/desktop/e2e and tests/.
  R12 editor-runtime is a narrowed boot API (ADR-011): editor-runtime
      sources import only relative sources, @elef/client, @elef/work-model,
      @elef/contracts and the pinned editor vendor modules; no package
      imports @elef/editor-runtime except the renderer seam
      @elef/editor-runtime/editor-chrome; no importer names an
      @elef/editor-runtime subpath beyond the package's exported
      subpaths (read from its export map: editor-chrome, test-internals).
  R13 package sources are TypeScript: zero *.js files under packages/*/src.
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
      fence-scan literals in apps/web/app/lib, crates or apps/desktop/src-tauri, except
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
  tooling/check_boundaries.py                 enforce R1-R13 on the repo
  tooling/check_boundaries.py --self-test     prove every rule rejects its
      deliberate canary (file fixtures under tooling/canary/ plus staged
      canaries for R2-repo-wide/R12/R13); exit 0 only when every canary
      is flagged
"""

from __future__ import annotations

import json
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


JS_SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
JS_EXCLUDED_PARTS = frozenset(
    {"node_modules", "dist", "dist-e2e", "logs", "test-results", "playwright-report"}
)

# Scopes outside packages/ whose importers must still respect R2 (F9).
DEEP_IMPORT_OUTSIDE_SCOPES = (
    "apps/web/test",
    "apps/desktop/e2e",
    "apps/web/app/javascript",
    "apps/desktop/frontend/src",
    "tests",
)


def js_sources(scope: Path) -> list[Path]:
    if not scope.is_dir():
        return []
    found = []
    for suffix in JS_SOURCE_SUFFIXES:
        found.extend(scope.rglob(f"*{suffix}"))
    return sorted(
        source
        for source in found
        if JS_EXCLUDED_PARTS.isdisjoint(source.relative_to(scope).parts)
    )


def check_deep_imports() -> list[str]:
    violations = []
    public = {path.parent.parent.name for path in PACKAGES.glob("*/src/index.*")}
    for package in sorted(PACKAGES.iterdir()):
        if not package.is_dir():
            continue
        for source in js_sources(package):
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
    for scope_name in DEEP_IMPORT_OUTSIDE_SCOPES:
        for source in js_sources(ROOT / scope_name):
            for specifier in specifiers(source):
                if not specifier.startswith("."):
                    continue
                target = (source.parent / specifier).resolve()
                try:
                    relative = target.relative_to(PACKAGES)
                except ValueError:
                    continue
                if len(relative.parts) > 1 and relative.parts[0] in public:
                    violations.append(
                        f"R2 deep import into package internals: {source.relative_to(ROOT)} -> {specifier}"
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


# The authorized renderer seam (frozen phase-12 plan, fixed cross-stream seam:
# S1 creates @elef/editor-runtime/editor-chrome exporting editorChrome,
# S4 consumes it for the renderer bundle entry). Only the renderer package
# may import editor-runtime, and only through this seam.
RENDERER_RUNTIME_SEAM = "@elef/editor-runtime/editor-chrome"


def editor_runtime_exported_subpaths() -> frozenset[str]:
    # R12 pins the narrowed boot API to the package's own export map, so a
    # reviewed new entry (editor-chrome, test-internals) is allowed without
    # editing this checker; anything deeper than an export still fails.
    package = json.loads((PACKAGES / "editor-runtime" / "package.json").read_text())
    return frozenset(
        f"@elef/editor-runtime{subpath[1:]}"
        for subpath in package.get("exports", {})
        if subpath.startswith("./")
    )
EDITOR_RUNTIME_ALLOWED_BARE = (
    "@elef/client",
    "@elef/work-model",
    "@elef/contracts",
    "@hotwired/stimulus",
    "codemirror",
    "@codemirror",
    "@lezer/highlight",
    "@replit/codemirror-vim",
    "katex",
)
# Packages that must never consume editor-runtime (contracts is covered by R1).
RUNTIME_REVERSE_PACKAGES = ("client", "work-model", "renderer")


def ts_sources(package: str) -> list[Path]:
    root = PACKAGES / package / "src"
    if not root.is_dir():
        return []
    return sorted(
        p
        for p in list(root.rglob("*.ts")) + list(root.rglob("*.tsx"))
        if "node_modules" not in p.parts and not p.name.endswith(".d.ts")
    )


def check_editor_runtime_direction() -> list[str]:
    violations = []
    for source in ts_sources("editor-runtime"):
        for specifier in specifiers(source):
            if specifier.startswith("."):
                target = (source.parent / specifier).resolve()
                try:
                    target.relative_to(PACKAGES / "editor-runtime")
                except ValueError:
                    violations.append(
                        f"R12 editor-runtime escapes its package: {source.relative_to(ROOT)} -> {specifier}"
                    )
                continue
            if any(
                specifier == allowed or specifier.startswith(f"{allowed}/")
                for allowed in EDITOR_RUNTIME_ALLOWED_BARE
            ):
                continue
            violations.append(
                f"R12 editor-runtime imports non-shared {specifier!r}: {source.relative_to(ROOT)}"
            )
    for package in RUNTIME_REVERSE_PACKAGES:
        for source in ts_sources(package):
            for specifier in specifiers(source):
                if not specifier.startswith("@elef/editor-runtime"):
                    continue
                if package == "renderer" and specifier == RENDERER_RUNTIME_SEAM:
                    continue
                violations.append(
                    f"R12 reverse dependency on editor-runtime: {source.relative_to(ROOT)} -> {specifier}"
                )
    subpath_scopes = [PACKAGES / package / "src" for package in sorted(
        p.name for p in PACKAGES.iterdir() if p.is_dir()
    )] + [ROOT / scope for scope in DEEP_IMPORT_OUTSIDE_SCOPES]
    exported = editor_runtime_exported_subpaths()
    for scope in subpath_scopes:
        for source in js_sources(scope):
            for specifier in specifiers(source):
                if not specifier.startswith("@elef/editor-runtime/"):
                    continue
                if specifier in exported:
                    continue
                violations.append(
                    f"R12 editor-runtime deep import beyond exported subpaths: {source.relative_to(ROOT)} -> {specifier}"
                )
    return violations


def check_no_package_js() -> list[str]:
    violations = []
    for package in sorted(PACKAGES.iterdir()):
        if not package.is_dir():
            continue
        root = package / "src"
        if not root.is_dir():
            continue
        for source in sorted(root.rglob("*.js")):
            if "node_modules" in source.parts:
                continue
            violations.append(
                f"R13 package sources must be TypeScript: {source.relative_to(ROOT)}"
            )
    return violations


SETTINGS_STYLESHEET_OWNER = Path("apps/web/app/assets/stylesheets/components/settings.css")

# Directory names that never hold a styles owner: generated bundles,
# vendored code, staged canary fixtures, and disposable review/gate
# checkouts or tool worktrees (which duplicate the whole tree, owner
# included).
SETTINGS_STYLE_EXCLUDED_PARTS = frozenset(
    {"node_modules", "dist", "dist-e2e", "builds", "tmp", ".git", "canary", ".muse"}
)


def check_settings_styles() -> list[str]:
    violations = []
    found = sorted(
        str(path.relative_to(ROOT))
        for path in ROOT.rglob("*settings*.css")
        if path.is_file() and SETTINGS_STYLE_EXCLUDED_PARTS.isdisjoint(path.relative_to(ROOT).parts)
    )
    if found != [SETTINGS_STYLESHEET_OWNER.as_posix()]:
        violations.append(
            "R11 settings styles must live only in "
            f"{SETTINGS_STYLESHEET_OWNER.as_posix()}: found {found}"
        )
    return violations


def check_no_reinterpretation() -> list[str]:
    violations = []
    scopes = [ROOT / "apps" / "web" / "app" / "lib", ROOT / "crates", ROOT / "apps" / "desktop" / "src-tauri"]
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
        + check_editor_runtime_direction()
        + check_no_package_js()
    )


# Staged canaries for the repo-wide R2 and the R12/R13 rules, written into
# the self-test stage programmatically (the scopes they cover have no file
# fixtures under tooling/canary/).
STAGED_CANARIES = {
    # R2 repo-wide: a web test reaching into package internals relatively.
    "apps/web/test/javascript/canary-deep.js": (
        "// DELIBERATE CANARY (R2 repo-wide): a test importing beneath a\n"
        "// package public entry through a relative path.\n"
        'import { WorkKind } from "../../../../packages/contracts/src/ids.js";\n'
        "\n"
        "export const canaryKind = WorkKind;\n"
    ),
    # R12: editor-runtime importing a host package outside its closure.
    "packages/editor-runtime/src/canary-vendor.ts": (
        "// DELIBERATE CANARY (R12): editor-runtime importing a host package.\n"
        'import { invoke } from "@tauri-apps/api/core";\n'
        "\n"
        "export async function canary(): Promise<void> {\n"
        '  await invoke("canary");\n'
        "}\n"
    ),
    # R12: a package depending back on editor-runtime.
    "packages/work-model/src/canary-runtime.ts": (
        "// DELIBERATE CANARY (R12): a package reversing the editor-runtime\n"
        "// dependency direction.\n"
        'import { registerEditorRuntime } from "@elef/editor-runtime";\n'
        "\n"
        "export const canary = registerEditorRuntime;\n"
    ),
    # R12: a host deep-importing a non-exported editor-runtime subpath.
    "apps/web/app/javascript/canary-runtime-deep.js": (
        "// DELIBERATE CANARY (R12): a per-controller deep import beyond the\n"
        "// exported editor-runtime subpaths.\n"
        'import { x } from "@elef/editor-runtime/controllers/visual_editor_controller.js";\n'
        "\n"
        "export const canary = x;\n"
    ),
    # R13: a JavaScript source under a package src/ directory.
    "packages/client/src/canary-plain.js": (
        "// DELIBERATE CANARY (R13): package sources must be TypeScript.\n"
        "export const canary = 1;\n"
    ),
}


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
        shutil.copytree(ROOT / "apps" / "web" / "app" / "lib", stage / "apps" / "web" / "app" / "lib")
        shutil.copytree(
            ROOT / "apps" / "web" / "app" / "assets" / "stylesheets",
            stage / "apps" / "web" / "app" / "assets" / "stylesheets",
        )
        for fixture in sorted(CANARY.rglob("*")):
            if not fixture.is_file():
                continue
            target = stage / fixture.relative_to(CANARY)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(fixture, target)
        for relative, content in sorted(STAGED_CANARIES.items()):
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        old_root, old_packages = ROOT, PACKAGES
        ROOT, PACKAGES = stage, stage / "packages"
        try:
            found = run_all()
        finally:
            ROOT, PACKAGES = old_root, old_packages
    expected = {"R1", "R2", "R4", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R13"}
    seen = {line.split()[0] for line in found}
    missing = expected - seen
    if missing:
        print(f"canary NOT rejected for: {sorted(missing)}", file=sys.stderr)
        for line in found:
            print(f"  {line}", file=sys.stderr)
        return 1
    r11 = [line for line in found if line.startswith("R11")]
    if not any("settings-duplicate" in line for line in r11):
        # The staged tree holds the owner plus the canary duplicate; an
        # R11 finding that names neither proves the rule scanned an empty
        # set (e.g. the checkout path itself was excluded) instead of
        # rejecting the duplicate.
        print("R11 did not name the staged duplicate owner:", file=sys.stderr)
        for line in r11:
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
    print("Architecture boundaries hold: contracts pure, no deep imports repo-wide, local-store Tauri-free, adapters transport-injected, packages directed and pure, no Work reinterpretation, client host-free and isolated, settings styles single-owned, editor-runtime narrowed, package sources TypeScript.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
