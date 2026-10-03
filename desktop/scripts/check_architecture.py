#!/usr/bin/env python3
"""Keep the Tauri invoke surface aligned with its declared capability."""

import hashlib
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
e2e_capability = json.loads((TAURI_ROOT / "capabilities" / "e2e.json").read_text())
config = json.loads((TAURI_ROOT / "tauri.conf.json").read_text())
e2e_config = json.loads((TAURI_ROOT / "tauri.e2e.conf.json").read_text())
feature_flags_source = (REPO_ROOT / "desktop" / "frontend" / "src" / "feature-flags.js").read_text()
delivery_plan = (REPO_ROOT / "docs" / "desktop" / "delivery-plan.md").read_text()
document_model = (REPO_ROOT / "app" / "lib" / "source" / "document.rb").read_text()
javascript_renderer = (REPO_ROOT / "app" / "lib" / "source" / "javascript_renderer.rb").read_text()
renderer_global = (REPO_ROOT / "desktop" / "frontend" / "src" / "renderer-global.js").read_text()
renderer_worker = (REPO_ROOT / "desktop" / "frontend" / "src" / "renderer-worker.js").read_text()
desktop_main = (REPO_ROOT / "desktop" / "frontend" / "src" / "main.js").read_text()
native_render_styles = (REPO_ROOT / "desktop" / "frontend" / "src" / "rendered-content.css").read_text()
assert 'import "../../../app/assets/stylesheets/application.css"' in desktop_main, "desktop must reuse Rails rendering and authoring styles"
assert not re.search(r"^\.(?:slide|document|presentation|katex)[\w.-]*(?:\s|\{|:)", native_render_styles, re.MULTILINE), "native viewport CSS must not contain another rendering stylesheet"

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
    "core:resources:allow-close",
}, "grant only events, safe window close, and releasing updater resources"
assert not any(permission.startswith(("fs:", "shell:", "dialog:")) for permission in permissions)
assert config["app"]["security"]["capabilities"] == ["main-capability"], "production must not attach the E2E WebDriver capability"
assert e2e_config["app"]["security"]["capabilities"] == ["main-capability", "e2e-webdriver"], "the test build must attach only the production and E2E capabilities"
assert set(e2e_capability["permissions"]) == {
    "wdio:default",
    "wdio-webdriver:default",
    "updater:allow-download",
    "core:app:allow-version",
}, "only the test-only capability may expose WebdriverIO and fixture downloads"
assert e2e_config["app"].get("withGlobalTauri") is True, "global Tauri access is enabled only for the test-only WebdriverIO build"
assert config["app"].get("withGlobalTauri") is not True, "production must not expose the global Tauri API"
assert config["plugins"]["updater"].get("requireSignedVersion") is True, "bind update versions to signed artifacts"
assert all(url.startswith("https://") for url in config["plugins"]["updater"]["endpoints"]), "production updater transport must use HTTPS"
assert not config["plugins"]["updater"].get("dangerousInsecureTransportProtocol"), "production must reject HTTP updater endpoints"
tauri_manifest = (TAURI_ROOT / "Cargo.toml").read_text()
assert 'webdriver = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]' in tauri_manifest, "WebdriverIO plugins must remain opt-in"
assert not re.search(r'^default\s*=.*\bwebdriver\b', tauri_manifest, re.MULTILINE), "production's default Cargo features must exclude WebDriver"
assert '#[cfg(feature = "webdriver")]\n    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());' in app_source, "production builds must not register the WebDriver plugin"
assert '#[cfg(feature = "webdriver")]\n    let builder = builder.plugin(tauri_plugin_wdio::init());' in app_source, "the WebdriverIO command plugin must be test-only"
assert 'frontendDist": "../frontend/dist-e2e"' in (TAURI_ROOT / "tauri.e2e.conf.json").read_text(), "WebdriverIO code must load from the isolated E2E frontend build"

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
assert re.search(r"def editor_map\([^)]*\).*?Source::JavascriptRenderer\.editor_map", document_model, re.DOTALL), "Rails editor maps must delegate to the shared JavaScript implementation"
assert '"ElefRenderer.buildEditorMap"' in javascript_renderer, "the Rails wrapper must call the shared map exported by the renderer bundle"
assert "buildEditorMap" in renderer_global and "buildEditorStructure" in renderer_global, "the renderer bundle must expose the shared editor map and structure"
assert 'import "./renderer.bundle.js"' in renderer_worker, "the desktop worker must load the same renderer bundle as Rails"
rails_bundle = REPO_ROOT / "vendor" / "javascript" / "elef-renderer.bundle.js"
desktop_bundle = REPO_ROOT / "desktop" / "frontend" / "dist" / "assets" / "renderer.bundle.js"
assert desktop_bundle.is_file(), "build the desktop frontend before checking the shared renderer bundle"
rails_hash = hashlib.sha256(rails_bundle.read_bytes()).hexdigest()
desktop_hash = hashlib.sha256(desktop_bundle.read_bytes()).hexdigest()
assert rails_hash == desktop_hash, "Rails and desktop renderer bundle hashes differ; run npm run build --prefix desktop/frontend"
assert not re.search(r"def (?:editor_blocks|editable_region_for_block|utf16_range)\b", document_model), "Rails must not retain a second editor-map implementation"
assert {
    permission
    for permission in permissions
    if ":" in permission and not permission.startswith("core:")
} == {
    "updater:allow-check",
    "process:allow-restart",
}, "grant only update checks and restart; installation must use the native confirmed staging command"

csp = config["app"]["security"]["csp"]
directives = {}
for part in csp.split(";"):
    tokens = part.strip().split()
    if tokens:
        directives[tokens[0]] = tokens[1:]
assert directives.get("script-src") == ["'self'"], "script-src must stay self-only"
assert "'unsafe-eval'" not in csp and "'unsafe-inline'" not in directives.get("script-src", [])
assert directives.get("style-src") == ["'self'"]
assert directives.get("style-src-attr") == ["'unsafe-inline'"], "allow only runtime style attributes required by CodeMirror and KaTeX"
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
