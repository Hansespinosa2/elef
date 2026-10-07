#!/usr/bin/env python3
"""Enforce Rails ownership of shared frontend code and one-way desktop reuse."""

import hashlib
import json
import os
import re
from collections import Counter
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

# Desktop packages the canonical host template and styles from app/. Do not
# allow a second authored view or stylesheet to appear under desktop/, even if
# its JavaScript happens to import shared modules. Native menus and dialogs
# are implemented with Tauri APIs and do not need frontend markup or CSS.
desktop_ui_extensions = {
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".jsx", ".tsx", ".vue", ".svelte",
}
generated_directories = {"node_modules", "dist", "dist-e2e", "target"}
desktop_ui_files = []
for directory, subdirectories, filenames in os.walk(desktop_root):
    subdirectories[:] = [name for name in subdirectories if name not in generated_directories]
    for filename in filenames:
        path = Path(directory) / filename
        if path.suffix.lower() in desktop_ui_extensions:
            desktop_ui_files.append(path.relative_to(ROOT).as_posix())
assert not desktop_ui_files, (
    "Desktop must consume Rails-owned UI markup and styles; move authored UI files under app/: "
    + ", ".join(sorted(desktop_ui_files))
)

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

app_host_sources = [*app_frontend.rglob("*.js"), ROOT / "app/views/desktop_host.html"]
desktop_protocol_violations = [
    path.relative_to(ROOT).as_posix()
    for path in app_host_sources
    if re.search(r"\belef(?:-preview|-upload|asset)://", path.read_text())
]
assert not desktop_protocol_violations, (
    "Desktop media URL schemes must stay in desktop transport adapters: "
    + ", ".join(desktop_protocol_violations)
)

build = (ROOT / "desktop/frontend/build.mjs").read_text()
desktop_main = (ROOT / "desktop/frontend/src/main.js").read_text()
tauri_config = json.loads((ROOT / "desktop/src-tauri/tauri.conf.json").read_text())
desktop_scripts = json.loads((ROOT / "desktop/frontend/package.json").read_text())["scripts"]
desktop_application = (ROOT / "app/javascript/lib/file_library_application.js").read_text()
desktop_shell_styles = (ROOT / "app/assets/stylesheets/file_library_host.css").read_text()
assert "globalThis.fetch =" not in desktop_application, (
    "The shared frontend must not replace the host fetch implementation"
)
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
math_modules = (
    ROOT / "app/javascript/controllers/live_preview.js",
    ROOT / "app/javascript/controllers/editor_math.js",
    ROOT / "app/javascript/controllers/editor_markdown.js",
)

# Rails browser imports resolve through importmap, while desktop esbuild resolves
# the same app-owned modules directly. Walk the Rails controller dependency graph
# so transitive app-owned modules cannot be missing from the importmap.
pending_modules = list((app_frontend / "controllers").rglob("*.js"))
visited_modules = set()
frontend_lib_imports = set()
while pending_modules:
    module = pending_modules.pop().resolve()
    if module in visited_modules:
        continue
    visited_modules.add(module)
    for specifier in MODULE_SPECIFIER.findall(module.read_text()):
        if specifier.startswith("lib/"):
            dependency = app_frontend / f"{specifier}.js"
            frontend_lib_imports.add(specifier)
        elif specifier.startswith(("./", "../")):
            dependency = (module.parent / specifier).resolve()
            if dependency.suffix != ".js" or app_frontend / "lib" not in dependency.parents:
                continue
            frontend_lib_imports.add(f"lib/{dependency.relative_to(app_frontend / 'lib').with_suffix('').as_posix()}")
        else:
            continue
        if dependency.is_file():
            pending_modules.append(dependency)

rails_lib_pins = set(re.findall(r'^pin "(lib/[^\"]+)"', importmap, re.MULTILINE))
missing_frontend_imports = sorted(frontend_lib_imports - rails_lib_pins)
assert not missing_frontend_imports, (
    "Every Rails-owned frontend lib import must be pinned in the Rails importmap: "
    + ", ".join(missing_frontend_imports)
)
frontend_shared_aliases = {
    specifier
    for path in app_frontend.rglob("*.js")
    for specifier in MODULE_SPECIFIER.findall(path.read_text())
    if specifier.startswith("#elef/")
}
rails_shared_alias_pins = set(re.findall(r'^pin "(#elef/[^\"]+)"', importmap, re.MULTILINE))
missing_shared_alias_pins = sorted(frontend_shared_aliases - rails_shared_alias_pins)
assert not missing_shared_alias_pins, (
    "Every shared Elef module alias must be pinned in the Rails importmap: "
    + ", ".join(missing_shared_alias_pins)
)

for module in math_modules:
    source = module.read_text()
    assert re.search(r'^import katex from "katex"$', source, re.MULTILINE), (
        f"{module.relative_to(ROOT)} must import the shared KaTeX module directly"
    )
    assert "globalThis.katex" not in source, (
        f"{module.relative_to(ROOT)} must not rely on a KaTeX global initialized by one runtime"
    )
assert "loadKatex" not in editor_runtime and "globalThis.katex" not in editor_runtime, (
    "Desktop bootstrap must not initialize a KaTeX global that Rails does not provide"
)

assert tauri_config["build"]["beforeDevCommand"]["script"] == tauri_config["build"]["beforeBuildCommand"], (
    "Tauri dev and production launches must build the same Rails-owned frontend"
)
assert tauri_config["build"]["beforeDevCommand"]["wait"] is True, (
    "Tauri dev must wait for the frontend build before loading static assets"
)
assert "npm run build" not in desktop_scripts["tauri:dev"], (
    "The Tauri dev wrapper must use the config hook instead of building twice"
)

# The Rails importmap and desktop bundle must run the same shared editor
# packages. Tauri-only packages stay in the desktop manifest.
desktop_package = json.loads((ROOT / "desktop/frontend/package.json").read_text())
root_package = json.loads((ROOT / "package.json").read_text())
desktop_shared_versions = {
    name: version
    for name, version in desktop_package["dependencies"].items()
    if not name.startswith("@tauri-apps/")
}
rails_pins = {
    name: version
    for name, version in re.findall(
        r'^pin "([^"]+)"(?:,\s*to:\s*"[^"]+")?\s+#\s*@([0-9][^\s]*)',
        importmap,
        re.MULTILINE,
    )
}
rails_shared_versions = {name: rails_pins.get(name) for name in desktop_shared_versions}
assert all(rails_shared_versions.values()), (
    "Every desktop-shared package must have an explicit version on its Rails importmap pin: "
    + ", ".join(sorted(name for name, version in rails_shared_versions.items() if not version))
)
assert rails_shared_versions == desktop_shared_versions, (
    "Rails importmap and desktop frontend package versions must match: "
    + ", ".join(
        f"{name} Rails={rails_shared_versions[name]} desktop={desktop_shared_versions[name]}"
        for name in sorted(desktop_shared_versions)
        if rails_shared_versions.get(name) != desktop_shared_versions[name]
    )
)
root_katex_version = root_package["devDependencies"].get("katex")
assert root_katex_version == desktop_package["dependencies"].get("katex") == rails_pins.get("katex"), (
    "Rails browser math, the shared renderer, and desktop must use one exact KaTeX package version"
)
assert 'pin "katex", to: "katex.js"' in importmap, "Rails must load the npm KaTeX browser module with a JavaScript MIME type"

def assert_same_file(left, right, description):
    left_hash = hashlib.sha256(left.read_bytes()).hexdigest()
    right_hash = hashlib.sha256(right.read_bytes()).hexdigest()
    assert left_hash == right_hash, f"{description} must be byte-identical ({left} != {right})"


katex_dist = ROOT / "node_modules/katex/dist"
assert_same_file(
    ROOT / "vendor/javascript/katex.js",
    katex_dist / "katex.mjs",
    "Rails' browser KaTeX module must match the pinned npm package",
)
assert_same_file(
    ROOT / "app/assets/stylesheets/katex/katex.min.css",
    katex_dist / "katex.min.css",
    "Rails' KaTeX stylesheet must match the pinned npm package",
)
rails_katex_fonts = ROOT / "app/assets/stylesheets/katex/fonts"
npm_katex_fonts = katex_dist / "fonts"
rails_font_names = {path.name for path in rails_katex_fonts.iterdir() if path.is_file()}
npm_font_names = {path.name for path in npm_katex_fonts.iterdir() if path.is_file()}
assert rails_font_names == npm_font_names, "Rails and npm KaTeX font asset sets must match"
for font_name in sorted(npm_font_names):
    assert_same_file(
        rails_katex_fonts / font_name,
        npm_katex_fonts / font_name,
        f"Rails KaTeX font {font_name} must match the pinned npm package",
    )

assert rails_pins.get("mermaid") == "11.17.2", "Rails must pin the reviewed vendored Mermaid version"
assert "vendor/javascript/mermaid.min.js" in build, "Desktop must package Rails' vendored Mermaid asset"
assert "mermaid@11.17.2" in (ROOT / "vendor/javascript/mermaid.min.js").read_text()[:200], (
    "The shared Mermaid asset must match its versioned Rails importmap pin"
)

# Both runners need the same shared workflow imports and executions. Explicit
# required exports make removing a flow from both adapters fail this check too.
shared_workflows = {
    "appearanceWorkflow",
    "authoringSettingsWorkflow",
    "documentPageAspectRatioWorkflow",
    "editAndPreviewWorkflow",
    "externalEditConflictWorkflow",
    "hostileDeckNeutralizedWorkflow",
    "libraryAndGraphWorkflow",
    "libraryCreateDeleteWorkflow",
    "mathInputWorkflow",
    "presentationModeWorkflow",
    "snippetInsertWorkflow",
    "vimRelativeLineNumbersWorkflow",
}
scenario_imports = {}
scenario_calls = {}
for runner in ("web", "desktop"):
    source = (ROOT / f"desktop/e2e/specs/{runner}.spec.js").read_text()
    imports = {}
    for clause, module in re.findall(
        r'^import\s+\{([^}]+)\}\s+from\s+["\']\.\./scenarios/([^"\']+)["\']',
        source,
        re.MULTILINE,
    ):
        imports[module] = set(re.findall(r"\b([A-Za-z_$][\w$]*Workflow)\b", clause))
    calls = Counter(re.findall(r"\bawait\s+([A-Za-z_$][\w$]*Workflow)\s*\(", source))
    imported_workflows = set().union(*imports.values()) if imports else set()
    assert imported_workflows == shared_workflows, (
        f"{runner} runner must import the complete shared workflow set; "
        f"missing={sorted(shared_workflows - imported_workflows)}, "
        f"extra={sorted(imported_workflows - shared_workflows)}"
    )
    assert set(calls) == shared_workflows, (
        f"{runner} runner must execute every imported shared workflow; "
        f"missing={sorted(shared_workflows - set(calls))}, "
        f"extra={sorted(set(calls) - shared_workflows)}"
    )
    scenario_imports[runner] = imports
    scenario_calls[runner] = calls
assert scenario_imports["web"] == scenario_imports["desktop"], (
    "Web and desktop must import the same shared scenario modules and workflow exports"
)
assert scenario_calls["web"] == scenario_calls["desktop"], (
    "Web and desktop must execute the same shared workflow scenarios with matching counts"
)

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
assert '"#elef/authoring-registry-write"' in authoring_settings_dialog, "authoring UI must use the app-owned persistence flow"
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
    "file-library-transport.js": "maps named app operations to the native file-library command surface",
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
