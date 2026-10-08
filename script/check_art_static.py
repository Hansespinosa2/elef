#!/usr/bin/env python3
"""Named architecture and CSS safety assertions for Elef Art v1."""

from pathlib import Path
import re
import json


ROOT = Path(__file__).resolve().parents[1]
ART_CSS = ROOT / "app/assets/stylesheets/components/art.css"
TOKEN_CSS = ROOT / "app/assets/stylesheets/tokens.css"
LAYOUT_JS = ROOT / "app/javascript/lib/art_layout.js"
CONTROLLER_JS = ROOT / "app/javascript/controllers/art_layout_controller.js"
SOURCE_JS = ROOT / "app/javascript/lib/art_source.js"
RENDERER_JS = ROOT / "app/javascript/lib/renderer.js"
GLOBAL_RENDERER_JS = ROOT / "app/javascript/lib/renderer_global.js"
AUTHORING_REGISTRY = ROOT / "app/javascript/data/default_authoring_registry.json"

required_tokens = {
    "--art-gap": "9px",
    "--art-peer-basis-compact": "200px",
    "--art-peer-basis-rich": "280px",
    "--art-sequence-min-inline": "200px",
    "--art-card-padding": "4px",
    "--art-radius": "10px",
    "--art-document-lead-size": "18px",
    "--art-document-body-size": "16px",
    "--art-presentation-lead-size": "24px",
    "--art-presentation-body-size": "17px",
}

token_css = TOKEN_CSS.read_text()
all_css = "\n".join(path.read_text() for path in (ROOT / "app/assets/stylesheets").rglob("*.css"))
art_css = ART_CSS.read_text()
layout_js = LAYOUT_JS.read_text()
controller_js = CONTROLLER_JS.read_text()
source_js = SOURCE_JS.read_text()
renderer_js = RENDERER_JS.read_text()
global_renderer_js = GLOBAL_RENDERER_JS.read_text()
authoring_registry = AUTHORING_REGISTRY.read_text()
authoring_entries = json.loads(authoring_registry)


def tokens_single_source():
    for name, value in required_tokens.items():
        declarations = re.findall(rf"{re.escape(name)}\s*:\s*([^;]+);", all_css)
        if declarations != [value] or not re.search(rf"{re.escape(name)}\s*:\s*{re.escape(value)};", token_css):
            return False
    return 'getPropertyValue("--art-gap")' in controller_js and 'getPropertyValue("--art-sequence-min-inline")' in controller_js


def no_shrink_or_truncation():
    forbidden = {
        "line clamping": r"\b(?:-webkit-)?line-clamp\s*:",
        "ellipsis": r"\btext-overflow\s*:\s*ellipsis",
        "hidden authored content": r"\bvisibility\s*:\s*hidden|\bdisplay\s*:\s*none|\boverflow\s*:\s*hidden",
        "responsive or shrinking font size": r"font-size\s*:[^;}]*\b(?:vw|cqw|clamp\s*\()",
        "zoom fitting": r"\bzoom\s*:",
        "transform fitting": r"\btransform\s*:[^;}]*\bscale\s*\(",
    }
    return not any(re.search(pattern, art_css, re.IGNORECASE | re.MULTILINE) for pattern in forbidden.values())


def active_theme_typography():
    return not re.search(r"\bfont-family\s*:", art_css, re.IGNORECASE) and "--work-surface-ink" in art_css and "--work-surface-background" in art_css


def peer_wrap_and_preferred_basis():
    return all(value in art_css for value in (
        "display: flex;", "flex-wrap: wrap;", "justify-content: center;",
        "flex: 0 1 var(--art-peer-basis-compact)", "flex: 0 1 var(--art-peer-basis-rich)"
    )) and not re.search(r"(?:^|[;{])\s*(?:left|right|inset-left|inset-right|margin-left|margin-right|padding-left|padding-right)\s*:", art_css, re.MULTILINE)


def native_sequence_markers_and_decoration():
    return "list-style: decimal" in art_css and "background-image: linear-gradient(currentColor, currentColor)" in art_css and "list-style: none" not in re.search(r'\.elef-art\[data-art-mode="sequence"\][^{]*\{[^}]*', art_css, re.DOTALL).group(0)


def fixed_host_positioned():
    rule = re.search(r'\[data-art-host="fixed"\]\s*\{([^}]*)\}', art_css, re.DOTALL)
    return bool(rule and re.search(r"position\s*:\s*relative\s*;", rule[1]) and re.search(r"min-height\s*:\s*0\s*;", rule[1]))


def fixed_geometry_uses_layout_space_and_css_tokens():
    return "getBoundingClientRect" not in layout_js + controller_js and "offsetParent" in layout_js and "clientWidth" in controller_js and tokens_single_source()


def shared_renderer_exports_art_api():
    return (
        "analyzeArtList" in renderer_js
        and "renderArtBlock" in global_renderer_js
        and "resolveArtBindings" in global_renderer_js
    )


def lifecycle_is_batched_and_cleaned_up():
    return all(fragment in controller_js for fragment in (
        "new ResizeObserver", "new MutationObserver", "requestAnimationFrame", "runDecisionPass",
        "runMeasurementPass", "runFallbackMeasurement", "resizeObserver?.disconnect()",
        "mutationObserver?.disconnect()", "document.fonts?.ready", 'addEventListener?.("loadingdone"'
    ))


def no_explicit_layout_dsl_or_deferred_decoration():
    art_commands = [entry for entry in authoring_entries if entry.get("trigger") == "art"]
    return (
        len(art_commands) == 1
        and art_commands[0].get("namespace") == ":"
        and art_commands[0].get("argument_schema", {}).get("argument_count") == 0
        and art_commands[0].get("behavior", {}).get("template") == ":::art"
        and not any(entry.get("namespace") == "/" and entry.get("trigger") == "art" for entry in authoring_entries)
        and not re.search(r'"(?:art-flow|art-sequence|art-peer|art-snake|art-grid)"', authoring_registry)
        and not re.search(r"art-(?:snake|chevron|arrow)", art_css + source_js, re.IGNORECASE)
        and not re.search(r"::(?:before|after)|<svg|icon", art_css, re.IGNORECASE)
    )


def dom_enums_and_stable_diagnostics():
    contract = renderer_js + controller_js + source_js
    return all(value in contract for value in (
        '"peers"', '"sequence"', '"compact"', '"rich"', '"ready"', '"pending"',
        '"fallback-unsupported"', '"fallback-no-fit"', '"error"', '"peers-wrap"',
        '"sequence-horizontal"', '"sequence-vertical"', '"plain-list"', '"true"', '"false"',
        'ART_NO_LIST_TARGET', 'ART_INVALID_SYNTAX', 'ART_UNSUPPORTED_CONTENT', 'ART_NO_FIT',
        'ART_ITEM_TOO_TALL', 'ART_INTERNAL_ERROR'
    )) and "data-art-diagnostic=\"${diagnostic}\"" in renderer_js


def forced_colors_keep_art_boundaries():
    return all(fragment in art_css for fragment in (
        "@media (forced-colors: active)",
        ".elef-art-list > li { border: 1px solid CanvasText; }",
        ".elef-art[data-art-mode=\"sequence\"] > .elef-art-list { background-image: linear-gradient(CanvasText, CanvasText); }"
    ))


STATIC_ASSERTIONS = {
    "TOKENS_SINGLE_SOURCE": tokens_single_source,
    "NO_SHRINK_OR_TRUNCATION": no_shrink_or_truncation,
    "ACTIVE_THEME_TYPOGRAPHY": active_theme_typography,
    "PEER_WRAP_AND_PREFERRED_BASIS": peer_wrap_and_preferred_basis,
    "NATIVE_SEQUENCE_MARKERS_AND_DECORATION": native_sequence_markers_and_decoration,
    "FIXED_HOST_POSITIONED": fixed_host_positioned,
    "FIXED_GEOMETRY_LAYOUT_SPACE_AND_CSS_TOKENS": fixed_geometry_uses_layout_space_and_css_tokens,
    "SHARED_RENDERER_EXPORTS_ART_API": shared_renderer_exports_art_api,
    "LIFECYCLE_BATCHED_AND_CLEANED_UP": lifecycle_is_batched_and_cleaned_up,
    "NO_EXPLICIT_LAYOUT_DSL_OR_DEFERRED_DECORATION": no_explicit_layout_dsl_or_deferred_decoration,
    "DOM_ENUMS_AND_STABLE_DIAGNOSTICS": dom_enums_and_stable_diagnostics,
    "FORCED_COLORS_KEEP_ART_BOUNDARIES": forced_colors_keep_art_boundaries,
}

for assertion_name, assertion in STATIC_ASSERTIONS.items():
    assert assertion(), f"Elef Art static assertion failed: {assertion_name}"

print(f"Elef Art static assertions passed ({len(STATIC_ASSERTIONS)} named checks)")
