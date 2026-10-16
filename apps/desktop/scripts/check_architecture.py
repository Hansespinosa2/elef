#!/usr/bin/env python3
"""Keep the Tauri invoke surface aligned with its declared capability."""

import hashlib
import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
TAURI_ROOT = REPO_ROOT / "apps" / "desktop" / "src-tauri"


def application_stylesheet_sources() -> str:
    stylesheet_root = REPO_ROOT / "apps" / "web" / "app" / "assets" / "stylesheets"
    index = (stylesheet_root / "application.css").read_text()
    imports = re.findall(r'(?m)^\s*@import url\("\.\/([^"\n]+\.css)"\) layer\([^)]+\);\s*$', index)
    return "\n".join((stylesheet_root / path).read_text() for path in imports)


def command_names(source: str, pattern: str) -> set[str]:
    match = re.search(pattern, source, re.DOTALL)
    if not match:
        raise AssertionError(f"could not find command list matching {pattern!r}")
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


build_source = (TAURI_ROOT / "build.rs").read_text()
app_source = (TAURI_ROOT / "src" / "lib.rs").read_text()
capability = json.loads((TAURI_ROOT / "capabilities" / "main.json").read_text())
e2e_capability = json.loads((TAURI_ROOT / "capabilities" / "e2e.json").read_text())
macos_updater_capability = json.loads((TAURI_ROOT / "capabilities" / "macos-updater.json").read_text())
config = json.loads((TAURI_ROOT / "tauri.conf.json").read_text())
e2e_config = json.loads((TAURI_ROOT / "tauri.e2e.conf.json").read_text())
e2e_stable_config = json.loads((TAURI_ROOT / "tauri.e2e-stable.conf.json").read_text())
performance_config = json.loads((TAURI_ROOT / "tauri.performance.conf.json").read_text())
assert performance_config == {"plugins": {"updater": {"endpoints": ["https://127.0.0.1:8888/manifest"]}}}, "release measurement must keep secure transport and a loopback-only offline check"
performance_benchmark = (REPO_ROOT / "apps" / "desktop" / "e2e" / "benchmark-native.mjs").read_text()
ci_workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
performance_workflow = (REPO_ROOT / ".github" / "workflows" / "native-performance.yml").read_text()
assert 'process.argv.includes("--report-runner")' in performance_benchmark, "hosted native performance must be identified explicitly"
assert 'report.budgetMode = reportOnly ? "runner-report-only" : "enforced"' in performance_benchmark
assert 'assert.deepEqual(report.misses, [], "Native release application performance exceeded its budgets")' in performance_benchmark, "target-device performance runs must keep hard budget assertions"
assert "benchmark-native.mjs" not in ci_workflow, "native measurements must not gate a pull-request CI job"
assert performance_workflow.count("benchmark-native.mjs --binary") == 2, "the scheduled workflow must keep one benchmark invocation per platform"
assert performance_workflow.count("--launch-count 20 --report-runner") == 2, "scheduled measurements must use an explicit bounded launch count on both platforms"
assert 'schedule:' in performance_workflow and 'push:\n    branches:\n      - dev' in performance_workflow and "pull_request:" not in performance_workflow, "native measurements must run on dev pushes and outside pull-request authorization"
assert 'DEFAULT_LAUNCH_COUNT = 20' in (REPO_ROOT / "apps" / "desktop" / "e2e" / "native-benchmark-config.js").read_text(), "local/target measurement default remains twenty launches"
feature_flags_source = (REPO_ROOT / "packages" / "editor-runtime" / "src" / "lib" / "feature_flags.ts").read_text()
feature_flags_doc = (REPO_ROOT / "docs" / "desktop" / "feature-flags.md").read_text()
document_model = (REPO_ROOT / "apps" / "web" / "app" / "lib" / "source" / "document.rb").read_text()
javascript_renderer = (REPO_ROOT / "apps" / "web" / "app" / "lib" / "source" / "javascript_renderer.rb").read_text()
renderer_global = (REPO_ROOT / "packages" / "editor-runtime" / "src" / "composed_renderer.ts").read_text()
renderer_worker = (REPO_ROOT / "apps" / "desktop" / "frontend" / "src" / "renderer-worker.js").read_text()
desktop_main = (REPO_ROOT / "apps" / "desktop" / "frontend" / "src" / "main.js").read_text()
desktop_application = (REPO_ROOT / "packages" / "editor-runtime" / "src" / "lib" / "file_library_application.ts").read_text()
native_render_styles = (REPO_ROOT / "apps" / "web" / "app" / "assets" / "stylesheets" / "file_library_host.css").read_text()
shared_application_styles = application_stylesheet_sources()
desktop_frontend_source = REPO_ROOT / "apps" / "desktop" / "frontend" / "src"
desktop_frontend_files = list(desktop_frontend_source.rglob("*"))
assert not any(path.suffix.lower() in {".html", ".css"} for path in desktop_frontend_files), "desktop frontend must consume Rails-owned markup and styles, not own UI files"
app_javascript_source = REPO_ROOT / "apps" / "web" / "app" / "javascript"
app_import_pattern = re.compile(r"(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['\"]([^'\"]+)['\"]")
for source_file in app_javascript_source.rglob("*.js"):
    source = source_file.read_text()
    for specifier in app_import_pattern.findall(source):
        path_parts = Path(specifier).parts
        assert not any(part == "desktop" or part.startswith("@tauri-apps") for part in path_parts), (
            f"Rails-owned frontend must not depend on desktop code: {source_file.relative_to(REPO_ROOT)} -> {specifier}"
        )
    assert "__TAURI__" not in source, f"Rails-owned frontend must not depend on Tauri globals: {source_file.relative_to(REPO_ROOT)}"
assert not re.search(r"(?m)(?:^|,)\s*h[1-6]\s*(?:,|\{)", native_render_styles), "desktop host heading rules must stay scoped away from shared view markup"
desktop_dom_ui_patterns = (
    r"\bdocument\.(?:querySelector(?:All)?|getElementById|createElement|createTextNode|body|documentElement)\b",
    r"\b(?:innerHTML|outerHTML|insertAdjacentHTML|classList|textContent)\b",
)
for source_file in desktop_frontend_source.rglob("*.js"):
    source = source_file.read_text()
    assert not any(re.search(pattern, source) for pattern in desktop_dom_ui_patterns), f"desktop frontend must not implement UI/UX DOM logic: {source_file.relative_to(REPO_ROOT)}"
shared_library_sources = [
    (REPO_ROOT / "packages" / "client" / "src" / "features" / "library" / name).read_text()
    for name in ("LibraryApp.tsx", "LibraryCard.tsx")
]
shared_library_sources.append(
    (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphView.ts").read_text()
)
shared_library_sources.append(
    (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphController.ts").read_text()
)
assert 'import "../../../../apps/web/app/assets/stylesheets/application.css"' in desktop_main, "desktop must bundle Rails rendering and authoring styles"
assert '"./performance_measurement.js"' in desktop_application, "desktop performance UI must reuse the shared browser measurement helper"
assert (REPO_ROOT / "apps" / "desktop" / "frontend" / "src" / "performance-measurement.js").exists() is False, "desktop must not own a second performance measurement helper"
assert not re.search(r"^\.(?:slide-frame|slide-content|presentation-surface|document-surface|katex)(?:\s|\{|:)", native_render_styles, re.MULTILINE), "the Rails-owned host stylesheet must not duplicate rendered-content styles"
shared_library_classes = set()
for source in shared_library_sources:
    for class_list in re.findall(r"\bclass(?:Name)?\s*=\s*['\"]([^'\"]*)['\"]", source):
        shared_library_classes.update(class_list.split())
    # The client graph view builds DOM through element()/svgElement() helpers
    # rather than JSX: element(document, "tag", "classes") and class: "...".
    for class_list in re.findall(r"\belement\(\s*document\s*,\s*\"[^\"]*\"\s*,\s*\"([^\"]*)\"", source):
        shared_library_classes.update(class_list.split())
    for class_list in re.findall(r"(?m)^\s*class:\s*\"([^\"]+)\"", source):
        shared_library_classes.update(class_list.split())
    for arguments in re.findall(r"classList\.(?:add|remove|toggle)\(([^)]*)\)", source):
        for class_list in re.findall(r"['\"]([^'\"]+)['\"]", arguments):
            shared_library_classes.update(class_list.split())
host_styled_classes = {
    class_name
    for selector_list in re.findall(r"([^{}]+)\{", native_render_styles)
    if not selector_list.strip().startswith("@")
    for class_name in re.findall(r"\.([\w-]+)", selector_list)
}
# State classes are generic across unrelated native dialogs and shared views;
# require the component class itself to stay on the owning Rails stylesheet.
host_styled_classes.discard("is-active")
duplicate_library_styles = shared_library_classes & host_styled_classes
assert not duplicate_library_styles, f"shared library UI classes must not be styled by the host stylesheet: {sorted(duplicate_library_styles)}"
for shared_selector in (
    ".library-shared-view h1",
    ".library-shared-view .library-card",
    ".library-shared-view .search-box",
    ".library-shared-view .library-card-preview",
    ".library-shared-view .work-action",
    ".library-shared-view .work-warning",
    ".library-shared-view .notice",
    ".library-tabs",
    ".library-tab",
    ".library-no-results",
    ".app-dialog",
):
    assert shared_selector in shared_application_styles, f"shared library styles must be owned by application.css: {shared_selector}"
shared_settings_sources = [
    (REPO_ROOT / "packages" / "client" / "src" / "features" / "settings" / name).read_text()
    for name in ("SettingsApp.tsx", "AuthoringDialog.tsx")
]
shared_settings_classes = set()
for source in shared_settings_sources:
    for class_list in re.findall(r"""\bclass(?:Name)?\s*=\s*['"]([^'"]*)['"]""", source):
        shared_settings_classes.update(class_list.split())
duplicate_settings_styles = shared_settings_classes & host_styled_classes
# dialog-copy is generic across unrelated native dialogs and shared views,
# like is-active above; the component classes themselves must stay off the
# native host stylesheet.
duplicate_settings_styles.discard("dialog-copy")
assert not duplicate_settings_styles, f"shared settings UI classes must not be styled by the host stylesheet: {sorted(duplicate_settings_styles)}"
for shared_selector in (
    ".settings-card",
    ".settings-control",
    ".authoring-entry-card",
    ".authoring-entry-actions",
    ".authoring-entry-form",
    ".snippet-card",
    ".snippet-example-preview",
    ".snippet-template",
    ".math-shortcut-card",
    ".math-shortcut-alias",
    ".authoring-settings-status",
    ".authoring-settings-list",
):
    assert shared_selector in shared_application_styles, f"shared settings styles must be owned by application.css: {shared_selector}"
web_shell = (REPO_ROOT / "apps" / "web" / "app" / "views" / "library" / "shell.html.erb").read_text()
web_controller = (REPO_ROOT / "apps" / "web" / "app" / "javascript" / "controllers" / "client_shell_controller.js").read_text()
client_index = (REPO_ROOT / "packages" / "client" / "src" / "index.ts").read_text()
graph_view = (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphView.ts").read_text()
graph_controller = (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphController.ts").read_text()
graph_partial = (REPO_ROOT / "apps" / "web" / "app" / "views" / "presentations" / "_document_graph.html.erb").read_text()
assert "export { mountElef }" in client_index, "the shared client must expose a single mount entry point"
assert '"@elef/client"' in web_controller and "mountElef" in web_controller, "Rails must mount library UI through the shared client entry"
assert '"@elef/client"' in desktop_application and "mountElef" in desktop_application, "desktop must mount the same shared client entry"
assert 'data-controller="client-shell"' in web_shell, "Rails library routes must mount the client shell"
assert "<article" not in web_shell, "Rails library shell must not duplicate client card markup"
assert "<article" not in desktop_application and 'createElement("article")' not in desktop_application, "desktop must not keep a second library card template"
assert "renderLibraryCard" not in desktop_application and "renderLibraryCard" not in web_controller, "both hosts must use the client mount, not the retired card renderer"
for retired in ("apps/web/app/javascript/lib/library_view.js", "apps/web/app/javascript/lib/library_card.js", "apps/web/app/views/library/_work_card.html.erb"):
    assert not (REPO_ROOT / retired).exists(), f"retired library implementation must stay deleted: {retired}"
assert "renderGraphView" in graph_view and "GraphController" in graph_controller, "the shared client must own graph rendering and interaction"
dev_graph_runtime = (REPO_ROOT / "apps" / "desktop" / "frontend" / "src" / "document-graph-runtime-dev.js").read_text()
stable_graph_runtime = (REPO_ROOT / "apps" / "desktop" / "frontend" / "src" / "document-graph-runtime-stable.js").read_text()
assert "renderGraphView" in dev_graph_runtime and "GraphController" in dev_graph_runtime and '"@elef/client"' in dev_graph_runtime, "the Dev graph runtime must assemble the shared client graph pieces"
assert "buildDocumentGraph" in dev_graph_runtime and '"@elef/work-model"' in dev_graph_runtime, "the Dev graph runtime must build from the shared work-model resolver"
assert "documentGraphRuntime = null" in stable_graph_runtime, "the Stable graph runtime must be null"
assert "documentGraphRuntime" in desktop_application, "desktop must receive the graph runtime as an injected input"
static_imports = [line for line in desktop_application.splitlines() if line.startswith("import ") and "import type" not in line]
assert not any("GraphController" in line or "renderGraphView" in line or "buildDocumentGraph" in line or "createDocumentGraphCache" in line or "mountHostPresentationEditor" in line for line in static_imports), "the shared desktop application must receive excluded slices as injected inputs, never static imports"
assert "renderGraphView" in web_controller and "GraphController" in web_controller, "Rails must render the graph through the shared client module"
assert "document-graph-node" not in graph_partial, "Rails must not keep a second document graph node template"
assert 'data-controller="document-graph"' not in graph_partial, "Rails must not keep the retired Stimulus graph mount"
assert "createElementNS" not in desktop_application and "document-graph-node" not in desktop_application, "desktop must not keep a second document graph node template"

declared = command_names(build_source, r"macro_rules! command_list \{(.*?)\$\(\$extra\)")
assert "document_graph" not in declared, "the graph command must not be in the production command base"
assert "install_update" not in declared, "the install command must not be in the production command base"
matrix_commands = set()
for command_call in re.findall(r"command_list!\((.*?)\)", build_source, re.DOTALL):
    matrix_commands.update(re.findall(r'"([a-z_]+)"', command_call))
assert matrix_commands == {"document_graph", "install_update", "export_diagnostics_fixture"}, (
    f"only the Dev graph command, the updater install command, and the diagnostics fixture may extend the base list: {sorted(matrix_commands)}"
)
assert 'std::env::var_os("CARGO_FEATURE_DESKTOP_DEV").is_some()' in build_source, (
    "the graph command must be gated on the desktop-dev feature"
)
assert 'std::env::var_os("CARGO_FEATURE_WEBDRIVER").is_some()' in build_source, (
    "test-only commands must be gated on the WebDriver feature"
)
assert "(desktop_dev, has_update_command, webdriver)" in build_source, "build.rs must gate commands on the desktop-dev, updater, and webdriver matrix"
assert 'let has_update_command = target_os == "macos" || (desktop_dev && webdriver);' in build_source, (
    "the install command must exist only on macOS or in the Dev WebDriver harness"
)
assert '(true, true, false) => command_list!("document_graph", "install_update")' in build_source, "the macOS Dev matrix cell must grant the graph and install commands"
assert '"document_graph",\n                "install_update",\n                "export_diagnostics_fixture"' in build_source, "the Dev e2e matrix cell must grant the graph and install commands plus the fixture"
assert '(true, false, false) => command_list!("document_graph")' in build_source, "the Linux Dev matrix cell must grant only the graph command"
assert '"install_update",\n                "export_diagnostics_fixture"' in build_source, "the macOS Stable e2e matrix cell must grant the install command plus the fixture"
assert '(false, true, false) => command_list!("install_update")' in build_source, "the macOS Stable matrix cell must grant only the install command"
assert '(false, false, true) => command_list!("export_diagnostics_fixture")' in build_source, "the Linux Stable e2e matrix cell must grant only the fixture"
assert "(false, false, false) => command_list!()" in build_source, "the Linux Stable matrix cell must grant no extra commands"
assert re.search(r'#\[cfg\(any\(\s*target_os = "macos",\s*all\(feature = "desktop-dev", feature = "webdriver"\)\s*\)\)\]', app_source), "Linux Stable must not compile updater code"
assert "app_commands!(document_graph)" in app_source and "app_commands!(install_update)" in app_source, "the handler matrix must cover the Dev-only and updater-only cells"
shared_command_references = sorted(
    f"{source_file.relative_to(REPO_ROOT)} -> {command}"
    for source_file in app_javascript_source.rglob("*.js")
    for command in declared | {"document_graph", "install_update"}
    if re.search(rf"(?<![\w])['\"]{re.escape(command)}['\"]", source_file.read_text())
)
assert not shared_command_references, (
    "Rails-owned frontend must call named platform services; keep Tauri command names in desktop adapters: "
    + ", ".join(shared_command_references)
)
assert not re.search(r"\binvoke\s*\(", desktop_application), "Shared application logic must not call raw Tauri IPC"
handler_match = re.search(
    r"tauri::generate_handler!\[(.*?)\$\(\$extra\)",
    app_source,
    re.DOTALL,
)
if not handler_match:
    raise AssertionError("could not find Tauri invoke handler")
registered = set(re.findall(r"^\s*([a-z_]+),\s*$", handler_match.group(1), re.MULTILINE))
assert '#[cfg(all(feature = "desktop-dev", feature = "webdriver"))]\n    let builder = builder.invoke_handler(app_commands!(\n        document_graph,\n        install_update,\n        export_diagnostics_fixture\n    ));' in app_source, (
    "the Dev WebDriver build must register the graph and install commands plus the fixture"
)
assert '#[cfg(all(\n        feature = "desktop-dev",\n        not(feature = "webdriver"),\n        target_os = "macos"\n    ))]\n    let builder = builder.invoke_handler(app_commands!(document_graph, install_update));' in app_source, (
    "the macOS Dev build must register the graph and install commands beyond the base list"
)
assert '#[cfg(all(\n        feature = "desktop-dev",\n        not(feature = "webdriver"),\n        not(target_os = "macos")\n    ))]\n    let builder = builder.invoke_handler(app_commands!(document_graph));' in app_source, (
    "the Linux Dev build must register only the graph command beyond the base list"
)
assert '#[cfg(all(\n        not(feature = "desktop-dev"),\n        target_os = "macos",\n        feature = "webdriver"\n    ))]\n    let builder = builder.invoke_handler(app_commands!(install_update, export_diagnostics_fixture));' in app_source, (
    "the macOS Stable WebDriver build must register the install command plus the fixture"
)
assert '#[cfg(all(\n        not(feature = "desktop-dev"),\n        target_os = "macos",\n        not(feature = "webdriver")\n    ))]\n    let builder = builder.invoke_handler(app_commands!(install_update));' in app_source, (
    "the macOS Stable build must register only the install command beyond the base list"
)
assert '#[cfg(all(\n        not(feature = "desktop-dev"),\n        not(target_os = "macos"),\n        feature = "webdriver"\n    ))]\n    let builder = builder.invoke_handler(app_commands!(export_diagnostics_fixture));' in app_source, (
    "the Linux Stable WebDriver build must register only the fixture beyond the base list"
)
assert '#[cfg(all(\n        not(feature = "desktop-dev"),\n        not(target_os = "macos"),\n        not(feature = "webdriver")\n    ))]\n    let builder = builder.invoke_handler(app_commands!());' in app_source, (
    "Linux Stable production builds must register only the base command list"
)
assert '.plugin(tauri_plugin_process::init())\n        .plugin(updater.build());' in app_source, (
    "the updater and restart plugins must register only where the updater boundary allows installs"
)
assert '"check-for-updates" => {' in app_source, (
    "the Stable macOS menu must keep its update-check action"
)
assert '#[cfg(feature = "desktop-dev")]\nuse crate::work_folders::document_graph;' in app_source, (
    "the graph command import must exist only under desktop-dev"
)
permissions = set(capability["permissions"])
allowed = {
    permission.removeprefix("allow-").replace("-", "_")
    for permission in permissions
    if permission.startswith("allow-")
    and not permission.startswith("core:")
}

assert declared == registered, f"build ACL and runtime invoke handler differ: {declared ^ registered}"
assert declared == allowed, f"capability command permissions differ: {declared ^ allowed}"
dev_capability = json.loads((TAURI_ROOT / "capabilities" / "main-dev.json").read_text())
dev_allowed = {
    permission.removeprefix("allow-").replace("-", "_")
    for permission in dev_capability["permissions"]
    if permission.startswith("allow-")
    and not permission.startswith("core:")
}
assert dev_allowed == declared | {"document_graph"}, f"the Dev capability must add exactly the graph command: {dev_allowed ^ (declared | {'document_graph'})}"
macos_updater_allowed = {
    permission.removeprefix("allow-").replace("-", "_")
    for permission in macos_updater_capability["permissions"]
    if permission.startswith("allow-")
    and not permission.startswith("core:")
}
assert macos_updater_allowed == {"install_update"}, f"only the macOS updater capability may activate a signed update: {sorted(macos_updater_allowed)}"
assert macos_updater_capability["platforms"] == ["macOS"], "updater command permissions must be macOS-only"
assert "core:default" not in permissions, "use only the individual core permissions needed"
assert {permission for permission in permissions if permission.startswith("core:")} == {
    "core:event:allow-listen",
    "core:event:allow-unlisten",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-set-fullscreen",
    "core:resources:allow-close",
}, "grant only events, window close completion, presentation fullscreen, and releasing updater resources"
assert "await this.destroy();" in (REPO_ROOT / "apps/desktop/frontend/node_modules/@tauri-apps/api/window.js").read_text(), "recheck window permissions when the close-listener implementation changes"
assert not any(permission.startswith(("fs:", "shell:", "dialog:")) for permission in permissions)
assert config["app"]["security"]["capabilities"] == ["main-capability", "macos-updater-capability"], "Stable must attach only its common and macOS-only updater capabilities"
assert e2e_config["app"]["security"]["capabilities"] == ["main-dev-capability", "e2e-webdriver"], "the Dev test build must attach only the Dev and E2E capabilities"
assert e2e_stable_config["app"]["security"]["capabilities"] == ["main-capability", "macos-updater-capability", "e2e-stable-webdriver"], "Stable runtime tests must use Stable native permissions"
e2e_updater = e2e_config["plugins"]["updater"]
assert e2e_updater["endpoints"] == ["http://127.0.0.1:8888/manifest"], "the E2E updater fixture must stay loopback-only"
assert e2e_updater.get("dangerousInsecureTransportProtocol") is True, "only the release-mode E2E fixture may opt into its loopback HTTP updater"
assert not performance_config.get("plugins", {}).get("updater", {}).get("dangerousInsecureTransportProtocol"), "the release measurement config must keep secure updater transport"
assert set(e2e_capability["permissions"]) == {
    "wdio:default",
    "wdio-webdriver:default",
    "allow-install-update",
    "updater:allow-check",
    "updater:allow-download",
    "process:allow-restart",
    "allow-export-diagnostics-fixture",
    "core:app:allow-version",
    "core:window:allow-is-fullscreen",
}, "only the test-only Dev capability may expose WebdriverIO and the loopback updater fixture"
assert "allow-export-diagnostics-fixture" not in permissions, (
    "the diagnostics export fixture must stay out of the production capability"
)
assert e2e_config["app"].get("withGlobalTauri") is True, "global Tauri access is enabled only for the test-only WebdriverIO build"
assert config["app"].get("withGlobalTauri") is not True, "production must not expose the global Tauri API"
production_frontend = (REPO_ROOT / "apps/desktop/frontend/dist/assets/app.js").read_text()
assert "__elefPerformanceTestHooks" not in production_frontend, "native measurement hooks must be absent from the production frontend"
assert "__elefPresentationTestHooks" not in production_frontend, "presentation test hooks must be absent from the production frontend"
assert config["plugins"]["updater"].get("requireSignedVersion") is True, "bind update versions to signed artifacts"
assert all(url.startswith("https://") for url in config["plugins"]["updater"]["endpoints"]), "production updater transport must use HTTPS"
assert not config["plugins"]["updater"].get("dangerousInsecureTransportProtocol"), "production must reject HTTP updater endpoints"
tauri_manifest = (TAURI_ROOT / "Cargo.toml").read_text()
assert 'webdriver = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]' in tauri_manifest, "WebdriverIO plugins must remain opt-in"
assert "desktop-dev = []" in tauri_manifest, "the Dev profile must stay an explicit Cargo feature"
assert not re.search(r"^default\s*=.*\bdesktop-dev\b", tauri_manifest, re.MULTILINE), "production's default Cargo features must exclude the Dev profile"
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
    assert re.search(rf"\| `{flag}` \| off \| on \|", feature_flags_doc), f"{flag} is missing from the feature register"
assert "applyDesktopFeatureFlags(document, featureFlags)" in desktop_application, "the shared application must apply the host feature flags at startup"
assert re.search(r"def editor_map\([^)]*\).*?Source::JavascriptRenderer\.editor_map", document_model, re.DOTALL), "Rails editor maps must delegate to the shared JavaScript implementation"
assert '"ElefRenderer.buildEditorMap"' in javascript_renderer, "the Rails wrapper must call the shared map exported by the renderer bundle"
assert "buildEditorMap" in renderer_global and "buildEditorStructure" in renderer_global, "the renderer bundle must expose the shared editor map and structure"
assert 'import "./composed_renderer.js"' in renderer_worker, "the desktop worker must load the same renderer bundle as Rails"
package_bundle = REPO_ROOT / "packages" / "editor-runtime" / "dist" / "composed_renderer.js"
desktop_bundle = REPO_ROOT / "apps" / "desktop" / "frontend" / "dist" / "assets" / "composed_renderer.js"
assert desktop_bundle.is_file(), "build the desktop frontend before checking the shared renderer bundle"
package_hash = hashlib.sha256(package_bundle.read_bytes()).hexdigest()
desktop_hash = hashlib.sha256(desktop_bundle.read_bytes()).hexdigest()
assert package_hash == desktop_hash, "package and desktop renderer bundle hashes differ; run npm run build:packages"
assert not re.search(r"def (?:editor_blocks|editable_region_for_block|utf16_range)\b", document_model), "Rails must not retain a second editor-map implementation"
assert not any(":" in permission for permission in permissions if not permission.startswith("core:")), "Stable common capability must not expose updater plugins"
assert set(macos_updater_capability["permissions"]) == {
    "allow-install-update",
    "updater:allow-check",
    "process:allow-restart",
}, "grant only signed macOS update checks, restart, and the native confirmed install command"

csp = config["app"]["security"]["csp"]
directives = {}
for part in csp.split(";"):
    tokens = part.strip().split()
    if tokens:
        directives[tokens[0]] = tokens[1:]
assert directives.get("script-src") == ["'self'"], "script-src must stay self-only"
assert "'unsafe-eval'" not in csp and "'unsafe-inline'" not in directives.get("script-src", [])
assert directives.get("style-src") == ["'self'", "'unsafe-inline'"], (
    "CodeMirror's style-mod runtime inserts its base and theme rules in inline style elements"
)
assert directives.get("style-src-attr") == ["'unsafe-inline'"], "allow inline geometry and formula styles used by CodeMirror and KaTeX"
assert "CodeMirror 6's `style-mod` inserts its base and theme rules in a `<style>` element" in (
    REPO_ROOT / "docs/desktop/data-format.md"
).read_text(), (
    "document why desktop CSP permits inline style elements"
)
assert directives.get("frame-src") == ["'none'"]
assert "https:" not in directives.get("img-src", [])
assert "*" not in directives.get("img-src", [])

associations = config["bundle"].get("fileAssociations", [])
assert any(
    "elef" in association.get("ext", [])
    and association.get("exportedType", {}).get("identifier") == "com.elef.work"
    for association in associations
), "register the portable .elef archive with the operating system"

for menu_action in (
    "open-work",
    "refresh-library",
    "save",
    "export-elef",
    "export-pptx",
    "import-elef",
    "print",
    "settings",
    "check-for-updates",
    "export-diagnostics",
):
    assert menu_action in app_source, f"native menu action {menu_action!r} is not wired"

print(f"Tauri command capability and CSP checks passed ({len(declared)} commands).")
