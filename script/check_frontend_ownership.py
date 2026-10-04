#!/usr/bin/env python3
"""Enforce Rails ownership of shared frontend code and one-way desktop reuse."""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHARED_RAILS_PATHS = ("app", "bin", "config", "lib", "script", "test")
DESKTOP_SOURCE_REFERENCE = re.compile(r"desktop/")
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

build = (ROOT / "desktop/frontend/build.mjs").read_text()
desktop_main = (ROOT / "desktop/frontend/src/main.js").read_text()
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
for shared_module in (
    "deck_open_flow", "document_graph_cache", "editor_ready", "editor_source",
    "feature_flags", "library_preview", "performance_measurement", "presentation_navigation", "renderer_worker_client",
    "authoring_registry_write", "save_flow", "title_save_flow",
):
    assert f'"lib/{shared_module}"' in desktop_main, f"desktop must consume app/javascript/lib/{shared_module}.js"
assert all(path.is_file() for path in renderer_sources), "renderer source must stay under app/javascript"
assert "desktop/" not in renderer_build, "Rails renderer generation must not reference desktop files"
desktop_sources = ROOT / "desktop/frontend/src"
for shared_source in (
    "authoring-registry-write.js", "authoring-settings.js", "deck-open-flow.js",
    "document-graph-cache.js", "document-map.js", "editor-ready.js", "editor-source.js",
    "feature-flags.js", "library-preview.js", "performance-measurement.js", "presentation-flow.js", "preview-sanitizer.js",
    "registry-merge.js", "renderer-client.js", "renderer-global.js", "renderer.js",
    "save-flow.js", "title-save-flow.js", "default-authoring-registry.json",
):
    assert not (desktop_sources / shared_source).exists(), f"shared source must not be copied under desktop/frontend/src: {shared_source}"

for host_asset in ("index.html", "theme.css", "styles.css"):
    assert not (ROOT / "desktop/frontend" / host_asset).exists(), f"shared shell source must stay under app/: {host_asset}"
for shared_test in ("authoring-settings.test.js", "feature-flags.test.js", "renderer-client.test.js", "renderer.test.js", "renderer-fixtures.test.js"):
    assert not (ROOT / "desktop/frontend/tests" / shared_test).exists(), f"shared behavior tests must stay under test/javascript: {shared_test}"

print("Frontend ownership checks passed: Rails owns shared source; desktop consumes it one-way.")
