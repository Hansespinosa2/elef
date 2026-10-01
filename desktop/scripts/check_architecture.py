#!/usr/bin/env python3
"""Keep the Tauri invoke surface aligned with its declared capability."""

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TAURI_ROOT = REPO_ROOT / "desktop" / "src-tauri"


def command_names(source: str, pattern: str) -> set[str]:
    match = re.search(pattern, source, re.DOTALL)
    if not match:
        raise AssertionError(f"could not find command list matching {pattern!r}")
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


build_source = (TAURI_ROOT / "build.rs").read_text()
app_source = (TAURI_ROOT / "src" / "lib.rs").read_text()
capability = json.loads((TAURI_ROOT / "capabilities" / "main.json").read_text())
config = json.loads((TAURI_ROOT / "tauri.conf.json").read_text())
feature_flags_source = (REPO_ROOT / "desktop" / "frontend" / "src" / "feature-flags.js").read_text()
delivery_plan = (REPO_ROOT / "docs" / "desktop" / "delivery-plan.md").read_text()

declared = command_names(build_source, r"let app_commands = &\[(.*?)\];")
handler_match = re.search(
    r"\.invoke_handler\(tauri::generate_handler!\[(.*?)\]\)",
    app_source,
    re.DOTALL,
)
if not handler_match:
    raise AssertionError("could not find Tauri invoke handler")
registered = set(re.findall(r"^\s*([a-z_]+),\s*$", handler_match.group(1), re.MULTILINE))
permissions = set(capability["permissions"])
allowed = {
    permission.removeprefix("allow-").replace("-", "_")
    for permission in permissions
    if permission.startswith("allow-")
    and not permission.startswith("core:")
}

assert declared == registered, f"build ACL and runtime invoke handler differ: {declared ^ registered}"
assert declared == allowed, f"capability command permissions differ: {declared ^ allowed}"
assert "core:default" not in permissions, "use only the individual core permissions needed"
assert {permission for permission in permissions if permission.startswith("core:")} == {
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:window:allow-close",
}, "grant only event subscriptions and programmatic close after a safe save"
assert not any(permission.startswith(("fs:", "shell:", "dialog:")) for permission in permissions)

feature_flags = {
    name: value == "true"
    for name, value in re.findall(r"^\s*(ELEF_ENABLE_[A-Z_]+): (true|false)", feature_flags_source, re.MULTILINE)
}
assert feature_flags == {
    "ELEF_ENABLE_REVISIONS": False,
    "ELEF_ENABLE_LINEAGE": False,
}, f"desktop deferred-feature defaults must stay explicitly off: {feature_flags}"
for flag in feature_flags:
    assert re.search(rf"\| `{flag}` \| off \| on \|", delivery_plan), f"{flag} is missing from the feature register"
assert "applyDesktopFeatureFlags(document)" in (REPO_ROOT / "desktop" / "frontend" / "src" / "main.js").read_text(), "desktop must apply the feature flags at startup"
assert {
    permission
    for permission in permissions
    if ":" in permission and not permission.startswith("core:")
} == {
    "updater:default",
    "process:allow-restart",
}, "grant only update check/install and restart from Tauri plugins"

csp = config["app"]["security"]["csp"]
directives = {}
for part in csp.split(";"):
    tokens = part.strip().split()
    if tokens:
        directives[tokens[0]] = tokens[1:]
assert directives.get("script-src") == ["'self'"], "script-src must stay self-only"
assert "'unsafe-eval'" not in csp and "'unsafe-inline'" not in directives.get("script-src", [])
assert directives.get("style-src") == ["'self'"]
assert directives.get("style-src-attr") == ["'unsafe-inline'"], "allow only CodeMirror's runtime style attributes"
assert directives.get("frame-src") == ["'none'"]
assert "https:" not in directives.get("img-src", [])
assert "*" not in directives.get("img-src", [])

associations = config["bundle"].get("fileAssociations", [])
assert any(
    "elef" in association.get("ext", [])
    and association.get("exportedType", {}).get("identifier") == "com.elef.deck"
    for association in associations
), "register the portable .elef archive with the operating system"

for menu_action in (
    "open-deck",
    "refresh-library",
    "save",
    "export-elef",
    "import-elef",
    "print",
    "settings",
    "check-for-updates",
):
    assert menu_action in app_source, f"native menu action {menu_action!r} is not wired"

print(f"Tauri command capability and CSP checks passed ({len(declared)} commands).")
