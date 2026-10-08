#!/usr/bin/env python3
"""Static architecture and CSS safety assertions for Elef Art v1."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
ART_CSS = ROOT / "app/assets/stylesheets/components/art.css"
TOKEN_CSS = ROOT / "app/assets/stylesheets/tokens.css"
LAYOUT_JS = ROOT / "app/javascript/lib/art_layout.js"
CONTROLLER_JS = ROOT / "app/javascript/controllers/art_layout_controller.js"
RENDERER_JS = ROOT / "app/javascript/lib/renderer.js"

required_tokens = {
    "--art-gap": "16px",
    "--art-peer-basis-compact": "200px",
    "--art-peer-basis-rich": "280px",
    "--art-sequence-min-inline": "200px",
    "--art-card-padding": "16px",
    "--art-radius": "10px",
    "--art-document-lead-size": "18px",
    "--art-document-body-size": "16px",
    "--art-presentation-lead-size": "24px",
    "--art-presentation-body-size": "18px",
}

token_css = TOKEN_CSS.read_text()
all_css = "\n".join(path.read_text() for path in (ROOT / "app/assets/stylesheets").rglob("*.css"))
art_css = ART_CSS.read_text()
for name, value in required_tokens.items():
    declarations = re.findall(rf"{re.escape(name)}\s*:\s*([^;]+);", all_css)
    assert declarations == [value], f"{name} must be declared once as {value}; found {declarations}"
    assert re.search(rf"{re.escape(name)}\s*:\s*{re.escape(value)};", token_css), f"{name} is missing from the shared token layer"

for label, pattern in {
    "line clamping": r"\b(?:-webkit-)?line-clamp\s*:",
    "ellipsis": r"\btext-overflow\s*:\s*ellipsis",
    "hidden authored content": r"\bvisibility\s*:\s*hidden|\bdisplay\s*:\s*none|\boverflow\s*:\s*hidden",
    "responsive or shrinking font size": r"font-size\s*:[^;}]*\b(?:vw|cqw|clamp\s*\()",
    "zoom fitting": r"\bzoom\s*:",
    "transform fitting": r"\btransform\s*:[^;}]*\bscale\s*\(",
    "physical direction positioning": r"(?:^|[;{])\s*(?:left|right|inset-left|inset-right|margin-left|margin-right|padding-left|padding-right)\s*:",
    "hard-coded font family": r"\bfont-family\s*:",
}.items():
    assert not re.search(pattern, art_css, re.IGNORECASE | re.MULTILINE), f"Art CSS contains prohibited {label}"

host_rule = re.search(r'\[data-art-host="fixed"\]\s*\{([^}]*)\}', art_css, re.DOTALL)
assert host_rule and re.search(r"position\s*:\s*relative\s*;", host_rule[1]) and re.search(r"min-height\s*:\s*0\s*;", host_rule[1]), "fixed Art hosts must establish a bounded positioned origin"
assert "flex-wrap: wrap" in art_css and "justify-content: center" in art_css, "Peers must wrap and center through CSS"
assert "flex: 0 1 var(--art-peer-basis-compact)" in art_css, "compact Peers must not grow into partial rows"
assert "flex: 0 1 var(--art-peer-basis-rich)" in art_css, "rich Peers must not grow into partial rows"
assert "list-style: decimal" in art_css and "sequence-horizontal" in art_css, "Sequence numbering must remain native"
assert "getPropertyValue(\"--art-gap\")" in CONTROLLER_JS.read_text(), "fixed fit math must read the shared gap token"
assert "getPropertyValue(\"--art-sequence-min-inline\")" in CONTROLLER_JS.read_text(), "fixed fit math must read the shared sequence token"
assert "getBoundingClientRect" not in LAYOUT_JS.read_text() + CONTROLLER_JS.read_text(), "fixed Art geometry must use untransformed layout-space properties"
assert 'tag === "ul"' in RENDERER_JS.read_text() and 'role="list"' in RENDERER_JS.read_text(), "Peers must restore list semantics when CSS removes native markers"

print("Elef Art CSS and architecture assertions passed")
