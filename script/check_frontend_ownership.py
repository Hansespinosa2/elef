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
    "library_preview", "presentation_navigation", "save_flow", "title_save_flow",
):
    assert f'"lib/{shared_module}"' in desktop_main, f"desktop must consume app/javascript/lib/{shared_module}.js"
assert all(path.is_file() for path in renderer_sources), "renderer source must stay under app/javascript"
assert "desktop/" not in renderer_build, "Rails renderer generation must not reference desktop files"
assert not any((ROOT / "desktop/frontend/src" / name).exists() for name in (
    "renderer.js", "document-map.js", "save-flow.js", "preview-sanitizer.js", "library-preview.js", "editor-ready.js"
)), "shared behavior must not be copied under desktop/frontend"

print("Frontend ownership checks passed: Rails owns shared source; desktop consumes it one-way.")
