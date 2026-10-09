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


def application_stylesheet_sources() -> str:
    stylesheet_root = ROOT / "app" / "assets" / "stylesheets"
    index = (stylesheet_root / "application.css").read_text()
    imports = re.findall(r'(?m)^\s*@import url\("\.\/([^"\n]+\.css)"\) layer\([^)]+\);\s*$', index)
    return "\n".join((stylesheet_root / path).read_text() for path in imports)

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
work_session = (ROOT / "app/javascript/lib/work_session.js").read_text()
client_library_app = (ROOT / "packages/client/src/features/library/LibraryApp.tsx").read_text()
client_library_card = (ROOT / "packages/client/src/features/library/LibraryCard.tsx").read_text()
client_library_filtering = (ROOT / "packages/client/src/features/library/filtering.ts").read_text()
web_authoring_settings = (ROOT / "app/javascript/controllers/client_shell_controller.js").read_text()
client_authoring_dialog = (ROOT / "packages/client/src/features/settings/AuthoringDialog.tsx").read_text()
desktop_shell_styles = (ROOT / "app/assets/stylesheets/file_library_host.css").read_text()
assert "globalThis.fetch =" not in desktop_application, (
    "The shared frontend must not replace the host fetch implementation"
)
shared_styles = application_stylesheet_sources()
client_presentation = (ROOT / "packages/client/src/features/presentation/presentation.js").read_text()
importmap = (ROOT / "config/importmap.rb").read_text()
renderer_build = (ROOT / "script/build_renderer.mjs").read_text()
renderer_sources = (
    ROOT / "packages/renderer/src/renderer.js",
    ROOT / "packages/work-model/src/document_links.js",
    ROOT / "packages/work-model/src/document_map.js",
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
# renderer_global.js is the esbuild bundle entry (script/build_renderer.mjs), never
# served through the importmap, so its package imports resolve via node_modules.
BUNDLED_ONLY = {app_frontend / "lib/renderer_global.js"}
frontend_package_imports = {
    specifier
    for path in app_frontend.rglob("*.js")
    if path not in BUNDLED_ONLY
    for specifier in MODULE_SPECIFIER.findall(path.read_text())
    if specifier.startswith("@elef/")
}
rails_package_pins = set(re.findall(r'^pin "(@elef/[^\"]+)"', importmap, re.MULTILINE))
# The work-model barrel is browser-loaded through the importmap, which does
# not rewrite relative specifiers: the barrel must use self-referential bare
# imports, and every barrel subpath must be pinned.
work_model_barrel = (ROOT / "packages/work-model/src/index.js").read_text()
assert '"./' not in work_model_barrel and '"../' not in work_model_barrel, (
    "packages/work-model/src/index.js must not use relative imports (browser-loaded)"
)
for subpath in ("@elef/work-model/document-map", "@elef/work-model/document-links"):
    assert subpath in rails_package_pins, f"work-model barrel subpath must be pinned: {subpath}"
missing_package_pins = sorted(frontend_package_imports - rails_package_pins)
assert not missing_package_pins, (
    "Every shared Elef package import must be pinned in the Rails importmap: "
    + ", ".join(missing_package_pins)
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
    "documentLinkCompletionWorkflow",
    "documentPageAspectRatioWorkflow",
    "editAndPreviewWorkflow",
    "externalEditConflictWorkflow",
    "hostileDeckNeutralizedWorkflow",
    "libraryAndGraphWorkflow",
    "libraryCreateDeleteWorkflow",
    "libraryDeepLinksWorkflow",
    "mathInputWorkflow",
    "presentationModeWorkflow",
    "snippetInsertWorkflow",
    "vimRelativeLineNumbersWorkflow",
}
shared_scenario_root = (ROOT / "test/e2e/scenarios").resolve()
assert shared_scenario_root.is_dir(), "shared web/desktop scenarios must live under Rails test/"
assert not (ROOT / "desktop/e2e/scenarios").exists(), "desktop must not own shared scenario definitions"
for scenario_path in shared_scenario_root.glob("*.js"):
    for specifier in MODULE_SPECIFIER.findall(scenario_path.read_text()):
        assert not specifier.startswith("@tauri-apps/"), (
            f"shared scenario must not depend on Tauri: {scenario_path.relative_to(ROOT)}"
        )
        if specifier.startswith("."):
            resolved = (scenario_path.parent / specifier).resolve()
            assert resolved.is_relative_to(shared_scenario_root), (
                f"shared scenario imports must stay within Rails test/e2e/scenarios: "
                f"{scenario_path.relative_to(ROOT)} -> {specifier}"
            )
scenario_imports = {}
scenario_calls = {}
for runner in ("web", "desktop"):
    source = (ROOT / f"desktop/e2e/specs/{runner}.spec.js").read_text()
    imports = {}
    for clause, module in re.findall(
        r'^import\s+\{([^}]+)\}\s+from\s+["\']\.\./\.\./\.\./test/e2e/scenarios/([^"\']+)["\']',
        source,
        re.MULTILINE,
    ):
        assert (shared_scenario_root / module).is_file(), (
            f"{runner} runner imports a missing Rails-owned scenario: {module}"
        )
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
for runner_source in (ROOT / "desktop/e2e/run.mjs",):
    for specifier in MODULE_SPECIFIER.findall(runner_source.read_text()):
        if "scenarios/" in specifier:
            resolved = (runner_source.parent / specifier).resolve()
            assert resolved.is_relative_to(shared_scenario_root) and resolved.is_file(), (
                f"desktop E2E helpers must consume Rails-owned scenarios: {specifier}"
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
assert '"lib/work_session"' in desktop_application, (
    "desktop save behavior must import the Rails-owned session factory"
)
assert "sanitizePreview" in client_library_card and '"../../ui/sanitize.js"' in client_library_card, (
    "desktop library previews must sanitize through the shared client module"
)
assert '"./save_flow.js"' in work_session, (
    "the shared work-session factory must consume the Rails-owned save state machine"
)
assert 'from "@elef/client"' in desktop_application, (
    "desktop library behavior must mount the shared client"
)
assert "export function filterWorks" in client_library_filtering, (
    "desktop library filtering must use the shared client rules"
)
assert "openAuthoringSettings" in desktop_application and "mountElef" in desktop_application, (
    "desktop authoring settings UI must mount the shared client"
)
assert "authoringTransport" in desktop_application and "platform.authoringTransport" in desktop_application, (
    "desktop authoring settings must persist through the injected registry transport seam"
)
assert "createRailsAuthoringSettingsTransport" in web_authoring_settings, (
    "web authoring settings must persist through the same registry transport seam as desktop"
)
settings_page = (ROOT / "app/views/shared/settings_page.html.erb").read_text()
assert 'render "shared/client_settings_mount"' in settings_page, (
    "web settings routes must mount the shared client instead of server-rendered settings markup"
)
for view_dir in ("app/views/snippets", "app/views/math_shortcuts", "app/views/workspace_settings"):
    assert not list((ROOT / view_dir).glob("*.html.erb")), (
        f"{view_dir} must not keep per-route settings shells; routes render the single shared settings page"
    )
for controller in (
    "app/controllers/snippets_controller.rb",
    "app/controllers/math_shortcuts_controller.rb",
    "app/controllers/workspace_settings_controller.rb",
):
    assert 'render template: "shared/settings_page"' in (ROOT / controller).read_text(), (
        f"{controller} must render the single shared settings page for HTML settings routes"
    )
assert 'id="authoring-settings-dialog"' in client_authoring_dialog, (
    "the shared client dialog must own the authoring DOM contract both hosts assert"
)
assert '"app/views/shared/_authoring_settings_dialog.html.erb"' not in build, (
    "desktop must not package the retired server-rendered authoring dialog"
)
assert '"lib/library_card"' not in desktop_application, "desktop must not keep the retired card renderer"
assert "export function cardDomId" in client_library_card, "desktop library cards must be owned by the shared client"
assert '"lib/editor_controller_lookup"' in desktop_application, "desktop editor lookup must use the app-owned controller helper"
assert '"@elef/work-model"' in desktop_application and "buildDocumentGraph" in desktop_application, (
    "desktop graph construction must consume the shared work-model resolver"
)
assert '"ElefRenderer.buildDocumentGraph"' in (ROOT / "app/lib/source/javascript_renderer.rb").read_text(), (
    "Rails graph construction must use the same app-owned resolver"
)
assert "markdown_document_links" not in (ROOT / "crates/local-store/src/lib.rs").read_text(), (
    "desktop core must not keep a parallel document-link parser"
)
assert "markdown_document_title" not in (ROOT / "crates/local-store/src/lib.rs").read_text(), (
    "desktop core must return source and folder name; Rails-owned JavaScript derives Markdown graph labels"
)
assert "extractFirstMarkdownHeading" in (ROOT / "packages/work-model/src/document_links.js").read_text(), (
    "document graph labels must use the shared work-model Markdown rules"
)
assert "transport.readRegistries" in client_authoring_dialog, (
    "authoring UI must load through the injected transport seam"
)
assert "writeRegistry" in client_authoring_dialog, (
    "authoring UI must persist through the injected transport seam"
)
assert "globalThis.fetch(" not in client_authoring_dialog and "invoke(" not in client_authoring_dialog, (
    "authoring UI must not reach a network or native layer past its transport seam"
)
assert '"controllers/presentation_controller"' not in editor_runtime, (
    "the retired Stimulus presentation controller must not load on demand"
)
assert not (ROOT / "app/javascript/controllers/presentation_controller.js").is_file(), (
    "the retired Stimulus presentation controller must be absent"
)
assert not (ROOT / "test/javascript/shared/presentation_controller.test.js").is_file(), (
    "the retired Stimulus presentation controller test must be absent"
)
assert "splitting: true" in build, "desktop must emit lazy ESM chunks instead of parsing every editor controller at launch"
assert 'import("controllers/editor_controller")' in editor_runtime, "the heavy shared editor controller must load on demand"
assert 'import("controllers/document_graph_controller")' not in editor_runtime, "the retired Stimulus graph controller must not load on demand"
assert "loadLibraryRuntime" not in editor_runtime, "no host may keep the retired graph controller loader"
assert "renderGraphView" in desktop_application and "GraphController" in desktop_application, (
    "desktop graph rendering must use the shared client graph module"
)
assert '"lib/renderer_worker"' in (ROOT / "desktop/frontend/src/renderer-worker.js").read_text(), (
    "desktop worker bootstrap must delegate renderer response behavior to app/javascript"
)
assert 'path.join(frontendRoot, "src/renderer-worker.js")' in build, (
    "desktop must bundle its worker bootstrap with the shared app-owned worker behavior"
)
assert (ROOT / "test/javascript/shared/renderer_worker.test.js").is_file(), (
    "shared renderer worker behavior must be tested under test/javascript"
)
assert "mountPresentation" in desktop_application, (
    "desktop presentation mode must mount slide behavior from the shared client"
)
assert "getControllerForElementAndIdentifier(elements.editorForm, \"presentation\")" not in desktop_application, (
    "desktop presentation mode must not reach the retired Stimulus presentation controller"
)
assert "createPresentationNavigation" not in desktop_application and "presentationActionForKey" not in desktop_application, (
    "desktop must not maintain its own slide navigation behavior"
)
assert "setLibraryViewTab" not in desktop_application, "desktop must not keep the retired tab helper"
assert "data-library-tab={name}" in client_library_app and "shell.setFilter" in desktop_application, (
    "desktop library tabs must use the shared client view behavior"
)
assert "elements.description.textContent" not in desktop_application, "library tab descriptions belong to the Rails-owned view"
assert "elements.graphView.hidden = libraryTab" not in desktop_application, "shared library graph visibility belongs to the Rails-owned view"
assert 'lib/presentation_navigation' not in importmap, (
    "Rails must not pin the retired host-owned navigation module"
)
assert '"./navigation.js"' in client_presentation, (
    "the client presentation controller must consume key mapping from the shared navigation module"
)
assert 'pin "lib/editor_controller_lookup", to: "lib/editor_controller_lookup.js"' in importmap, (
    "Rails must resolve the shared editor controller lookup"
)
assert '"lib/presentation_navigation"' not in client_presentation, "the shared controller must not keep host-owned key mapping"
for shared_module in (
    "deck_open_flow", "document_graph_cache", "editor_ready", "editor_source",
    "feature_flags", "performance_measurement", "renderer_worker_client",
    "request_identity", "work_session", "title_save_flow",
):
    assert f'"lib/{shared_module}"' in desktop_application, f"desktop application must consume app/javascript/lib/{shared_module}.js"
assert "renderPreviewCore" in client_library_card and '"@elef/client/preview-core"' in client_library_card, (
    "desktop library previews must render through the shared renderer core"
)
preview_core_entry = (ROOT / "packages/client/src/features/library/preview-core.ts").read_text()
assert '"@elef/renderer"' in preview_core_entry and "renderPreviewCore" in preview_core_entry, (
    "the deferred preview entry must re-export the shared renderer core, not fork it"
)
assert 'pin "@elef/client/preview-core", to: "client/dist/preview-core.js"' in importmap, (
    "Rails must serve the deferred preview renderer entry"
)
client_presentation_editor = (ROOT / "packages/client/src/features/presentation/editor.js").read_text()
assert '"lib/projection_editability"' not in client_presentation_editor, (
    "the client presentation editor must receive editing utilities through injection, not host imports"
)
assert not (ROOT / "app/javascript/controllers/presentation_editor_controller.js").is_file(), (
    "the retired Stimulus presentation editor must be absent"
)
assert '"controllers/presentation_editor_controller"' not in editor_runtime, (
    "the retired Stimulus presentation editor must not load on demand"
)
assert "mountHostPresentationEditor" in (ROOT / "app/javascript/lib/presentation_editor_host.js").read_text(), (
    "both hosts must mount the client presentation editor through the shared host seam"
)
assert '"lib/projection_editability"' in (ROOT / "app/javascript/controllers/visual_editor_controller.js").read_text()
assert 'pin "lib/projection_editability", to: "lib/projection_editability.js"' in importmap
assert all(path.is_file() for path in renderer_sources), "renderer sources must stay in shared app/javascript or packages"
assert "desktop/" not in renderer_build, "Rails renderer generation must not reference desktop files"
bundle_entry = (ROOT / "app/javascript/lib/renderer_global.js").read_text()
assert (ROOT / "app/javascript/lib/preview_chrome.js").is_file(), "editor chrome must live in the app-side preview_chrome module"
assert '"./preview_chrome.js"' in bundle_entry and "editorChrome" in bundle_entry, (
    "the bundle entry must compose bare projection with editor chrome"
)
for bridge_function in (
    "parsePortableDocumentLinks", "extractFirstMarkdownHeading", "frontMatterHasKey",
    "readStyle", "readStyleOverrides", "normalizeThemeValue", "normalizeTypographyValue",
    "withFrontMatterValue", "replaceFirstHeading", "sourceAnchorLines",
):
    assert bridge_function in bundle_entry, f"the bundle must export the work-model bridge function {bridge_function}"
desktop_sources = ROOT / "desktop/frontend/src"
desktop_source_reasons = {
    "authoring-registry-loader.js": "loads the library's native authoring-registry commands",
    "bootstrap-flow.js": "orders native app startup and its readiness handshake",
    "close-flow.js": "coordinates native window close with the save transport",
    "file-library-transport.js": "maps named app operations to the native file-library command surface",
    "main.js": "boots the Rails-owned application with Tauri services and native lifecycle",
    "media-transport.js": "adapts browser media fetches to Tauri IPC and asset protocols",
    "preview-transport.js": "adapts the shared renderer to the desktop preview endpoint",
    "quiet_save_policy.js": "declares desktop quiet-save timing injected into the shared session factory",
    "renderer-worker.js": "starts the packaged renderer bundle in a Web Worker",
    "tauri-authoring-transport.js": "implements the shared authoring-registry seam over native registry commands",
    "tauri-host.js": "implements the ElefHost contract over Tauri invoke for the desktop shell",
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
