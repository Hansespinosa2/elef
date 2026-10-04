#!/usr/bin/env python3
"""Enforce Rails ownership of shared frontend code and one-way desktop reuse."""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHARED_RAILS_PATHS = ("app", "bin", "config", "lib", "script", "test")
DESKTOP_SOURCE_REFERENCE = re.compile(r"desktop/")
MODULE_SPECIFIER = re.compile(r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)[\"']([^\"']+)[\"']")
checker = Path(__file__).resolve()

violations = []
for directory in SHARED_RAILS_PATHS:
    for path in (ROOT / directory).rglob("*"):
        if not path.is_file() or path == checker:
            continue
        try:
            contents = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        if DESKTOP_SOURCE_REFERENCE.search(contents):
            violations.append(path.relative_to(ROOT).as_posix())

assert not violations, (
    "Rails-owned source, build scripts, and tests must not depend on desktop files: "
    + ", ".join(violations)
)

app_frontend = ROOT / "app" / "javascript"
desktop_root = (ROOT / "desktop").resolve()
frontend_import_violations = []
for path in app_frontend.rglob("*.js"):
    source = path.read_text()
    if "@tauri-apps/" in source or "__TAURI__" in source:
        frontend_import_violations.append(f"{path.relative_to(ROOT)} directly uses Tauri APIs")
    for specifier in MODULE_SPECIFIER.findall(source):
        if specifier.startswith(("@tauri-apps/", "desktop/", "/desktop/")):
            frontend_import_violations.append(f"{path.relative_to(ROOT)} imports {specifier}")
        elif specifier.startswith(("./", "../")):
            target = (path.parent / specifier).resolve()
            if target == desktop_root or desktop_root in target.parents:
                frontend_import_violations.append(f"{path.relative_to(ROOT)} imports {specifier}")

assert not frontend_import_violations, (
    "Rails frontend modules must not depend on Tauri or desktop source: "
    + ", ".join(frontend_import_violations)
)

build = (ROOT / "desktop/frontend/build.mjs").read_text()
desktop_main = (ROOT / "desktop/frontend/src/main.js").read_text()
presentation_controller = (ROOT / "app/javascript/controllers/presentation_controller.js").read_text()
importmap = (ROOT / "config/importmap.rb").read_text()
renderer_build = (ROOT / "script/build_renderer.mjs").read_text()
renderer_sources = (
    ROOT / "app/javascript/lib/renderer.js",
    ROOT / "app/javascript/lib/document_map.js",
    ROOT / "app/javascript/lib/renderer_global.js",
)

assert '"app/views/desktop_shell/index.html"' in build, "desktop must consume the Rails-owned host template"
assert '"app/assets/stylesheets/desktop_shell.css"' in build, "desktop shell styles must be sourced from app/"
assert '"app/assets/builds/tailwind.css"' in build, "desktop must package the checked-in Rails-generated utility stylesheet"
assert (ROOT / "app/assets/builds/tailwind.css").is_file(), "shared utility CSS must be present in a clean checkout"
assert '"vendor/javascript/elef-renderer.bundle.js"' in build, "desktop must package the Rails-owned renderer artifact"
assert "bin/rails" not in build and "execFileSync" not in build, "desktop packaging must not boot Rails"
assert "app/javascript" in build, "desktop bundling must resolve frontend code from app/javascript"
assert "script/build_renderer.mjs" not in build, "desktop must consume the renderer build, not own it"
assert '"lib/save_flow"' in desktop_main and '"lib/preview_sanitizer"' in desktop_main, (
    "desktop save and preview behavior must import Rails-owned modules"
)
assert '"lib/library_view"' in desktop_main and '"lib/library_filter"' in desktop_main, (
    "desktop library behavior must import Rails-owned components"
)
assert '"lib/authoring_settings_dialog"' in desktop_main, "desktop authoring settings UI must consume the Rails-owned dialog"
assert '"lib/library_card"' in desktop_main, "desktop library cards must be owned by app/javascript"
authoring_settings_dialog = (ROOT / "app/javascript/lib/authoring_settings_dialog.js").read_text()
assert '"./authoring_registry_write.js"' in authoring_settings_dialog, "authoring UI must use the app-owned persistence flow"
assert '"controllers/presentation_controller"' in (ROOT / "desktop/frontend/src/editor-runtime.js").read_text(), (
    "desktop must register the Rails-owned presentation controller"
)
assert '"presentation"' in desktop_main and "getControllerForElementAndIdentifier(elements.editorForm, \"presentation\")" in desktop_main, (
    "desktop presentation mode must delegate slide behavior to the Rails-owned controller"
)
assert "createPresentationNavigation" not in desktop_main and "presentationActionForKey" not in desktop_main, (
    "desktop must not maintain its own slide navigation behavior"
)
assert 'pin "lib/presentation_navigation", to: "lib/presentation_navigation.js"' in importmap, (
    "Rails must resolve the shared presentation navigation module"
)
assert '"lib/presentation_navigation"' in presentation_controller, "the shared controller must own presentation key mapping"
assert "write_authoring_registry" not in (ROOT / "app/javascript/lib/authoring_registry_write.js").read_text(), (
    "Rails-owned authoring flow must receive persistence through a host transport callback"
)
for shared_module in (
    "deck_open_flow", "document_graph_cache", "editor_ready", "editor_source",
    "feature_flags", "library_preview", "performance_measurement", "renderer_worker_client",
    "authoring_settings_dialog", "save_flow", "title_save_flow",
):
    assert f'"lib/{shared_module}"' in desktop_main, f"desktop must consume app/javascript/lib/{shared_module}.js"
assert all(path.is_file() for path in renderer_sources), "renderer source must stay under app/javascript"
assert "desktop/" not in renderer_build, "Rails renderer generation must not reference desktop files"
desktop_sources = ROOT / "desktop/frontend/src"
desktop_source_reasons = {
    "authoring-registry-loader.js": "loads the library's native authoring-registry commands",
    "bootstrap-flow.js": "orders native app startup and its readiness handshake",
    "close-flow.js": "coordinates native window close with the save transport",
    "editor-runtime.js": "registers the shared Stimulus controllers in the desktop shell",
    "main.js": "binds app-owned product views to native commands and window lifecycle",
    "media-transport.js": "adapts browser media fetches to Tauri IPC and asset protocols",
    "preview-transport.js": "adapts the shared renderer to the desktop preview endpoint",
    "renderer-worker.js": "starts the packaged renderer bundle in a Web Worker",
    "transport-adapter.js": "maps Rails-shaped requests to native command calls",
    "update-flow.js": "drives the Tauri updater and native relaunch",
}
actual_desktop_sources = {
    path.relative_to(desktop_sources).as_posix()
    for path in desktop_sources.rglob("*")
    if path.is_file()
}
assert actual_desktop_sources == set(desktop_source_reasons), (
    "Every desktop frontend source needs a reviewed shell-specific reason; "
    "move host-agnostic product logic into app/javascript. "
    f"Missing classification: {sorted(actual_desktop_sources - set(desktop_source_reasons))}; "
    f"stale classification: {sorted(set(desktop_source_reasons) - actual_desktop_sources)}"
)
assert all(desktop_source_reasons.values()), "Every desktop frontend source classification needs a reason"

for host_asset in ("index.html", "theme.css", "styles.css"):
    assert not (ROOT / "desktop/frontend" / host_asset).exists(), f"shared shell source must stay under app/: {host_asset}"
for shared_test in ("authoring-settings.test.js", "feature-flags.test.js", "renderer-client.test.js", "renderer.test.js", "renderer-fixtures.test.js"):
    assert not (ROOT / "desktop/frontend/tests" / shared_test).exists(), f"shared behavior tests must stay under test/javascript: {shared_test}"

print("Frontend ownership checks passed: Rails owns shared source; desktop consumes it one-way.")
