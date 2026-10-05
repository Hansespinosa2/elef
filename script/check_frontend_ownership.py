#!/usr/bin/env python3
"""Enforce Rails ownership of shared frontend code and one-way desktop reuse."""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHARED_RAILS_PATHS = ("app", "bin", "config", "lib", "script")
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
desktop_application = (ROOT / "app/javascript/lib/file_library_application.js").read_text()
desktop_shell_styles = (ROOT / "app/assets/stylesheets/file_library_host.css").read_text()
shared_styles = (ROOT / "app/assets/stylesheets/application.css").read_text()
presentation_controller = (ROOT / "app/javascript/controllers/presentation_controller.js").read_text()
importmap = (ROOT / "config/importmap.rb").read_text()
renderer_build = (ROOT / "script/build_renderer.mjs").read_text()
renderer_sources = (
    ROOT / "app/javascript/lib/renderer.js",
    ROOT / "app/javascript/lib/document_links.js",
    ROOT / "app/javascript/lib/document_map.js",
    ROOT / "app/javascript/lib/renderer_global.js",
)
editor_runtime = (ROOT / "app/javascript/lib/editor_runtime.js").read_text()

assert 'path.join(repoRoot, "app/views/desktop_host.html")' in build, "the Rails-owned host template must be packaged by the desktop build"
assert 'path.join(repoRoot, "app/assets/stylesheets/file_library_host.css")' in build, "the Rails-owned host stylesheet must be packaged by the desktop build"
assert '"app/assets/builds/tailwind.css"' in build, "desktop must package the checked-in Rails-generated utility stylesheet"
assert (ROOT / "app/assets/builds/tailwind.css").is_file(), "shared utility CSS must be present in a clean checkout"
assert '"vendor/javascript/elef-renderer.bundle.js"' in build, "desktop must package the Rails-owned renderer artifact"
assert "bin/rails" not in build and "execFileSync" not in build, "desktop packaging must not boot Rails"
assert "app/javascript" in build, "desktop bundling must resolve frontend code from app/javascript"
assert 'import "../../../app/assets/stylesheets/application.css"' in desktop_main, "desktop must bundle the Rails-owned application styles"
assert "startFileLibraryApplication" in desktop_main and "document.querySelector" not in desktop_main, (
    "the desktop entry point must only wire native services into the Rails-owned application"
)
assert 'from "lib/editor_runtime"' in desktop_main, "desktop must consume the Rails-owned Stimulus controller runtime"
assert "@tauri-apps/" not in desktop_application and "desktop/" not in desktop_application, (
    "the Rails-owned file-library application must depend on injected host services, not desktop code"
)
assert "script/build_renderer.mjs" not in build, "desktop must consume the renderer build, not own it"
assert '"lib/save_flow"' in desktop_application and '"lib/preview_sanitizer"' in desktop_application, (
    "desktop save and preview behavior must import Rails-owned modules"
)
assert '"lib/library_view"' in desktop_application and '"lib/library_filter"' in desktop_application, (
    "desktop library behavior must import Rails-owned components"
)
assert '"lib/authoring_settings_dialog"' in desktop_application, "desktop authoring settings UI must consume the Rails-owned dialog"
assert '"lib/library_card"' in desktop_application, "desktop library cards must be owned by app/javascript"
assert '"lib/editor_controller_lookup"' in desktop_application, "desktop editor lookup must use the app-owned controller helper"
assert '"lib/document_links"' in desktop_application and "buildDocumentGraph" in desktop_application, (
    "desktop graph construction must consume the Rails-owned resolver"
)
assert '"ElefRenderer.buildDocumentGraph"' in (ROOT / "app/lib/source/javascript_renderer.rb").read_text(), (
    "Rails graph construction must use the same app-owned resolver"
)
assert "markdown_document_links" not in (ROOT / "desktop/crates/elef-core/src/lib.rs").read_text(), (
    "desktop core must not keep a parallel document-link parser"
)
assert "markdown_document_title" not in (ROOT / "desktop/crates/elef-core/src/lib.rs").read_text(), (
    "desktop core must return source and folder name; Rails-owned JavaScript derives Markdown graph labels"
)
assert "extractFirstMarkdownHeading" in (ROOT / "app/javascript/lib/document_links.js").read_text(), (
    "document graph labels must use the Rails-owned Markdown rules"
)
authoring_settings_dialog = (ROOT / "app/javascript/lib/authoring_settings_dialog.js").read_text()
assert '"./authoring_registry_write.js"' in authoring_settings_dialog, "authoring UI must use the app-owned persistence flow"
assert '"controllers/presentation_controller"' in editor_runtime, (
    "the Rails-owned controller runtime must register the shared presentation controller"
)
assert "splitting: true" in build, "desktop must emit lazy ESM chunks instead of parsing every editor controller at launch"
assert 'import("controllers/editor_controller")' in editor_runtime, "the heavy shared editor controller must load on demand"
assert 'import("controllers/document_graph_controller")' in editor_runtime, "the shared graph controller must load on demand"
assert '"lib/renderer_worker"' in (ROOT / "desktop/frontend/src/renderer-worker.js").read_text(), (
    "desktop worker bootstrap must delegate renderer response behavior to app/javascript"
)
assert 'path.join(frontendRoot, "src/renderer-worker.js")' in build, (
    "desktop must bundle its worker bootstrap with the shared app-owned worker behavior"
)
assert (ROOT / "test/javascript/shared/renderer_worker.test.js").is_file(), (
    "shared renderer worker behavior must be tested under test/javascript"
)
assert '"presentation"' in desktop_application and "getControllerForElementAndIdentifier(elements.editorForm, \"presentation\")" in desktop_application, (
    "desktop presentation mode must delegate slide behavior to the Rails-owned controller"
)
assert "createPresentationNavigation" not in desktop_application and "presentationActionForKey" not in desktop_application, (
    "desktop must not maintain its own slide navigation behavior"
)
assert "setLibraryViewTab" in desktop_application, "desktop library tabs must use the Rails-owned shared view behavior"
assert "elements.description.textContent" not in desktop_application, "library tab descriptions belong to the Rails-owned view"
assert "elements.graphView.hidden = libraryTab" not in desktop_application, "shared library graph visibility belongs to the Rails-owned view"
assert 'pin "lib/presentation_navigation", to: "lib/presentation_navigation.js"' in importmap, (
    "Rails must resolve the shared presentation navigation module"
)
assert 'pin "lib/editor_controller_lookup", to: "lib/editor_controller_lookup.js"' in importmap, (
    "Rails must resolve the shared editor controller lookup"
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
    assert f'"lib/{shared_module}"' in desktop_application, f"desktop application must consume app/javascript/lib/{shared_module}.js"
assert '"lib/projection_editability"' in (ROOT / "app/javascript/controllers/presentation_editor_controller.js").read_text()
assert '"lib/projection_editability"' in (ROOT / "app/javascript/controllers/visual_editor_controller.js").read_text()
assert 'pin "lib/projection_editability", to: "lib/projection_editability.js"' in importmap
assert all(path.is_file() for path in renderer_sources), "renderer source must stay under app/javascript"
assert "desktop/" not in renderer_build, "Rails renderer generation must not reference desktop files"
desktop_sources = ROOT / "desktop/frontend/src"
desktop_source_reasons = {
    "authoring-registry-loader.js": "loads the library's native authoring-registry commands",
    "bootstrap-flow.js": "orders native app startup and its readiness handshake",
    "close-flow.js": "coordinates native window close with the save transport",
    "main.js": "boots the Rails-owned application with Tauri services and native lifecycle",
    "media-transport.js": "adapts browser media fetches to Tauri IPC and asset protocols",
    "preview-transport.js": "adapts the shared renderer to the desktop preview endpoint",
    "renderer-worker.js": "starts the packaged renderer bundle in a Web Worker",
    "transport-adapter.js": "maps Rails-shaped requests to native command calls",
    "update-flow.js": "drives the Tauri updater and native relaunch",
}
actual_desktop_sources = {
    path.relative_to(desktop_sources).as_posix()
    for path in desktop_sources.rglob("*")
    if path.is_file() and path.suffix == ".js"
}
assert actual_desktop_sources == set(desktop_source_reasons), (
    "Every desktop frontend source needs a reviewed shell-specific reason; "
    "move host-agnostic product logic into app/javascript. "
    f"Missing classification: {sorted(actual_desktop_sources - set(desktop_source_reasons))}; "
    f"stale classification: {sorted(set(desktop_source_reasons) - actual_desktop_sources)}"
)
assert all(desktop_source_reasons.values()), "Every desktop frontend source classification needs a reason"

assert not re.search(r"\.document-graph(?:-[\w-]+)?", desktop_shell_styles), "document graph styles must be shared from the Rails-owned stylesheet"
assert ".document-graph-canvas" in shared_styles, "Rails must retain the canonical document graph styles"
assert (ROOT / "app/views/desktop_host.html").is_file(), "the workbench host template must be owned by the Rails app"
assert (ROOT / "app/assets/stylesheets/file_library_host.css").is_file(), "the workbench stylesheet must be owned by the Rails app"
assert not (ROOT / "desktop/frontend/index.html").exists(), "desktop must not maintain a second host template"
assert not (ROOT / "desktop/frontend/src/desktop-shell.css").exists(), "desktop must not own product layout styles"
assert not (ROOT / "desktop/frontend/src/desktop-rendered-content.css").exists(), "desktop must not own rendered-content styles"
assert len(desktop_main.splitlines()) < 80, "the desktop frontend entry point must remain a thin native bootstrap"
assert all(path.suffix not in {".html", ".css"} for path in (ROOT / "desktop/frontend/src").rglob("*")), (
    "HTML and CSS product source must stay in app/"
)
desktop_frontend_dom_violations = []
for path in (ROOT / "desktop/frontend/src").rglob("*.js"):
    source = path.read_text()
    if re.search(r"document\.(?:querySelector|createElement|body|documentElement)|\.textContent|\.innerHTML|\.classList", source):
        desktop_frontend_dom_violations.append(path.relative_to(ROOT).as_posix())
assert not desktop_frontend_dom_violations, (
    "Desktop frontend adapters must not implement product DOM or presentation logic: "
    + ", ".join(desktop_frontend_dom_violations)
)
for shared_test in ("authoring-settings.test.js", "deck-open-flow.test.js", "feature-flags.test.js", "renderer-client.test.js", "renderer.test.js", "renderer-fixtures.test.js"):
    assert not (ROOT / "desktop/frontend/tests" / shared_test).exists(), f"shared behavior tests must stay under test/javascript: {shared_test}"
assert not (ROOT / "desktop/frontend/tests/host-page.test.js").exists(), "host template tests must stay with the Rails-owned frontend"

print("Frontend ownership checks passed: Rails owns shared source; desktop consumes it one-way.")
