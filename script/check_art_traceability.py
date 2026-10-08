#!/usr/bin/env python3
"""Check unique constitution IDs and concrete Elef Art verification references."""

from pathlib import Path
import json
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
CONSTITUTION = ROOT / "docs/smartart/CONSTITUTION.md"
MANIFEST = ROOT / "docs/smartart/VERIFICATION.json"
STATIC_CHECKS = ROOT / "script/check_art_static.py"

requirement_pattern = re.compile(r"^\| (ART-[A-Z]+-\d{3}) \|")
constitution_ids = [
    match.group(1)
    for line in CONSTITUTION.read_text().splitlines()
    if (match := requirement_pattern.match(line))
]
duplicates = sorted({identifier for identifier in constitution_ids if constitution_ids.count(identifier) > 1})
if duplicates:
    raise SystemExit(f"Duplicate normative Art requirement IDs: {', '.join(duplicates)}")

manifest = json.loads(MANIFEST.read_text())
requirements = manifest.get("requirements", {})
constitution_set = set(constitution_ids)
manifest_set = set(requirements)
missing = sorted(constitution_set - manifest_set)
extra = sorted(manifest_set - constitution_set)
if missing or extra:
    raise SystemExit(f"Requirement manifest mismatch; missing={missing}, extra={extra}")

static_source = STATIC_CHECKS.read_text()
static_block = re.search(r"STATIC_ASSERTIONS\s*=\s*\{(.*?)\n\}", static_source, re.DOTALL)
if not static_block:
    raise SystemExit("Named STATIC_ASSERTIONS map was not found")
static_names = set(re.findall(r'"([A-Z][A-Z0-9_]+)"\s*:', static_block.group(1)))

allowed_statuses = {"VERIFIED", "FAILED", "BLOCKED_EXTERNAL"}
for identifier in constitution_ids:
    entry = requirements[identifier]
    status = entry.get("status")
    references = entry.get("verification", [])
    if status not in allowed_statuses:
        raise SystemExit(f"{identifier}: invalid status {status!r}")
    if not references:
        raise SystemExit(f"{identifier}: at least one concrete verification reference is required")
    for reference in references:
        if reference.startswith("static:"):
            target = reference.removeprefix("static:")
            script, separator, assertion = target.partition("#")
            if not separator or script != "script/check_art_static.py" or assertion not in static_names:
                raise SystemExit(f"{identifier}: unknown named static assertion {reference!r}")
        elif reference.startswith("doc:"):
            target = reference.removeprefix("doc:")
            path, separator, marker = target.partition("#")
            document = ROOT / path
            if not separator or not document.is_file() or marker not in document.read_text():
                raise SystemExit(f"{identifier}: stale documentation reference {reference!r}")
        elif reference.startswith("test:"):
            target = reference.removeprefix("test:")
            path, separator, marker = target.partition("#")
            test_file = ROOT / path
            if not separator or not test_file.is_file() or marker not in test_file.read_text():
                raise SystemExit(f"{identifier}: stale test reference {reference!r}")
        else:
            raise SystemExit(f"{identifier}: unsupported verification reference {reference!r}")

print(f"Elef Art traceability passed ({len(constitution_ids)} unique requirement IDs)")
