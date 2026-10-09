#!/usr/bin/env python3
"""Keep the Tauri invoke surface aligned with its declared capability."""

import hashlib
import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TAURI_ROOT = REPO_ROOT / "desktop" / "src-tauri"


def application_stylesheet_sources() -> str:
    stylesheet_root = REPO_ROOT / "app" / "assets" / "stylesheets"
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
config = json.loads((TAURI_ROOT / "tauri.conf.json").read_text())
e2e_config = json.loads((TAURI_ROOT / "tauri.e2e.conf.json").read_text())
performance_config = json.loads((TAURI_ROOT / "tauri.performance.conf.json").read_text())
assert performance_config == {"plugins": {"updater": {"endpoints": ["https://127.0.0.1:8888/manifest"]}}}, "release measurement must keep secure transport and a loopback-only offline check"
performance_benchmark = (REPO_ROOT / "desktop" / "e2e" / "benchmark-native.mjs").read_text()
ci_workflow = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
assert 'process.argv.includes("--report-runner")' in performance_benchmark, "hosted native performance must be identified explicitly"
assert 'report.budgetMode = reportOnly ? "runner-report-only" : "enforced"' in performance_benchmark
assert 'assert.deepEqual(report.misses, [], "Native release application performance exceeded its budgets")' in performance_benchmark, "target-device performance runs must keep hard budget assertions"
assert ci_workflow.count("benchmark-native.mjs --binary") == 2 and ci_workflow.count("--report-runner") == 2, "both hosted benchmark jobs must report their measurements without claiming target-device enforcement"
feature_flags_source = (REPO_ROOT / "app" / "javascript" / "lib" / "feature_flags.js").read_text()
delivery_plan = (REPO_ROOT / "docs" / "desktop" / "delivery-plan.md").read_text()
document_model = (REPO_ROOT / "app" / "lib" / "source" / "document.rb").read_text()
javascript_renderer = (REPO_ROOT / "app" / "lib" / "source" / "javascript_renderer.rb").read_text()
renderer_global = (REPO_ROOT / "app" / "javascript" / "lib" / "renderer_global.js").read_text()
renderer_worker = (REPO_ROOT / "desktop" / "frontend" / "src" / "renderer-worker.js").read_text()
desktop_main = (REPO_ROOT / "desktop" / "frontend" / "src" / "main.js").read_text()
desktop_application = (REPO_ROOT / "app" / "javascript" / "lib" / "file_library_application.js").read_text()
native_render_styles = (REPO_ROOT / "app" / "assets" / "stylesheets" / "file_library_host.css").read_text()
shared_application_styles = application_stylesheet_sources()
desktop_frontend_source = REPO_ROOT / "desktop" / "frontend" / "src"
desktop_frontend_files = list(desktop_frontend_source.rglob("*"))
assert not any(path.suffix.lower() in {".html", ".css"} for path in desktop_frontend_files), "desktop frontend must consume Rails-owned markup and styles, not own UI files"
app_javascript_source = REPO_ROOT / "app" / "javascript"
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
assert 'import "../../../app/assets/stylesheets/application.css"' in desktop_main, "desktop must bundle Rails rendering and authoring styles"
assert 'lib/performance_measurement' in desktop_application, "desktop performance UI must reuse the Rails-owned browser measurement helper"
assert (REPO_ROOT / "desktop" / "frontend" / "src" / "performance-measurement.js").exists() is False, "desktop must not own a second performance measurement helper"
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
    ".library-shared-view .deck-action",
    ".library-shared-view .deck-warning",
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
web_shell = (REPO_ROOT / "app" / "views" / "library" / "shell.html.erb").read_text()
web_controller = (REPO_ROOT / "app" / "javascript" / "controllers" / "client_shell_controller.js").read_text()
client_index = (REPO_ROOT / "packages" / "client" / "src" / "index.ts").read_text()
graph_view = (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphView.ts").read_text()
graph_controller = (REPO_ROOT / "packages" / "client" / "src" / "features" / "graph" / "graphController.ts").read_text()
graph_partial = (REPO_ROOT / "app" / "views" / "presentations" / "_document_graph.html.erb").read_text()
assert "export { mountElef }" in client_index, "the shared client must expose a single mount entry point"
assert '"@elef/client"' in web_controller and "mountElef" in web_controller, "Rails must mount library UI through the shared client entry"
assert '"@elef/client"' in desktop_application and "mountElef" in desktop_application, "desktop must mount the same shared client entry"
assert 'data-controller="client-shell"' in web_shell, "Rails library routes must mount the client shell"
assert "<article" not in web_shell, "Rails library shell must not duplicate client card markup"
assert "<article" not in desktop_application and 'createElement("article")' not in desktop_application, "desktop must not keep a second library card template"
assert "renderLibraryCard" not in desktop_application and "renderLibraryCard" not in web_controller, "both hosts must use the client mount, not the retired card renderer"
for retired in ("app/javascript/lib/library_view.js", "app/javascript/lib/library_card.js", "app/views/library/_work_card.html.erb"):
    assert not (REPO_ROOT / retired).exists(), f"retired library implementation must stay deleted: {retired}"
assert "renderGraphView" in graph_view and "GraphController" in graph_controller, "the shared client must own graph rendering and interaction"
assert "renderGraphView" in desktop_application and "GraphController" in desktop_application, "desktop must render the graph through the shared client module"
assert "renderGraphView" in web_controller and "GraphController" in web_controller, "Rails must render the graph through the shared client module"
assert "document-graph-node" not in graph_partial, "Rails must not keep a second document graph node template"
assert 'data-controller="document-graph"' not in graph_partial, "Rails must not keep the retired Stimulus graph mount"
assert "createElementNS" not in desktop_application and "document-graph-node" not in desktop_application, "desktop must not keep a second document graph node template"

declared = command_names(build_source, r"let app_commands = &\[(.*?)\];")
shared_command_references = sorted(
    f"{source_file.relative_to(REPO_ROOT)} -> {command}"
    for source_file in app_javascript_source.rglob("*.js")
    for command in declared
    if re.search(rf"(?<![\w])['\"]{re.escape(command)}['\"]", source_file.read_text())
)
assert not shared_command_references, (
    "Rails-owned frontend must call named platform services; keep Tauri command names in desktop adapters: "
    + ", ".join(shared_command_references)
)
assert not re.search(r"\binvoke\s*\(", desktop_application), "Rails-owned application logic must not call raw Tauri IPC"
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
    "core:window:allow-destroy",
    "core:window:allow-set-fullscreen",
    "core:resources:allow-close",
}, "grant only events, window close completion, presentation fullscreen, and releasing updater resources"
assert "await this.destroy();" in (REPO_ROOT / "desktop/frontend/node_modules/@tauri-apps/api/window.js").read_text(), "recheck window permissions when the close-listener implementation changes"
assert not any(permission.startswith(("fs:", "shell:", "dialog:")) for permission in permissions)
assert config["app"]["security"]["capabilities"] == ["main-capability"], "production must not attach the E2E WebDriver capability"
assert e2e_config["app"]["security"]["capabilities"] == ["main-capability", "e2e-webdriver"], "the test build must attach only the production and E2E capabilities"
assert set(e2e_capability["permissions"]) == {
    "wdio:default",
    "wdio-webdriver:default",
    "updater:allow-download",
    "core:app:allow-version",
    "core:window:allow-is-fullscreen",
}, "only the test-only capability may expose WebdriverIO and fixture downloads"
assert e2e_config["app"].get("withGlobalTauri") is True, "global Tauri access is enabled only for the test-only WebdriverIO build"
assert config["app"].get("withGlobalTauri") is not True, "production must not expose the global Tauri API"
production_frontend = (REPO_ROOT / "desktop/frontend/dist/assets/app.js").read_text()
assert "__elefPerformanceTestHooks" not in production_frontend, "native measurement hooks must be absent from the production frontend"
assert "__elefPresentationTestHooks" not in production_frontend, "presentation test hooks must be absent from the production frontend"
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
assert "applyDesktopFeatureFlags(document)" in desktop_application, "the Rails-owned application must apply feature flags at startup"
assert re.search(r"def editor_map\([^)]*\).*?Source::JavascriptRenderer\.editor_map", document_model, re.DOTALL), "Rails editor maps must delegate to the shared JavaScript implementation"
assert '"ElefRenderer.buildEditorMap"' in javascript_renderer, "the Rails wrapper must call the shared map exported by the renderer bundle"
assert "buildEditorMap" in renderer_global and "buildEditorStructure" in renderer_global, "the renderer bundle must expose the shared editor map and structure"
assert 'import "./renderer.bundle.js"' in renderer_worker, "the desktop worker must load the same renderer bundle as Rails"
rails_bundle = REPO_ROOT / "vendor" / "javascript" / "elef-renderer.bundle.js"
desktop_bundle = REPO_ROOT / "desktop" / "frontend" / "dist" / "assets" / "renderer.bundle.js"
assert desktop_bundle.is_file(), "build the desktop frontend before checking the shared renderer bundle"
rails_hash = hashlib.sha256(rails_bundle.read_bytes()).hexdigest()
desktop_hash = hashlib.sha256(desktop_bundle.read_bytes()).hexdigest()
assert rails_hash == desktop_hash, "Rails and desktop renderer bundle hashes differ; run npm run renderer:build"
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
assert directives.get("style-src") == ["'self'", "'unsafe-inline'"], (
    "CodeMirror's style-mod runtime inserts its base and theme rules in inline style elements"
)
assert directives.get("style-src-attr") == ["'unsafe-inline'"], "allow inline geometry and formula styles used by CodeMirror and KaTeX"
assert "CodeMirror 6's `style-mod` inserts its base and theme rules in a `<style>` element" in (
    REPO_ROOT / "docs/desktop/security.md"
).read_text(), (
    "document why desktop CSP permits inline style elements"
)
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
