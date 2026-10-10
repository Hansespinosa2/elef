#!/usr/bin/env python3
"""Validate the frozen persisted-format fixtures in spec/ against their schemas.

Minimal-honest scope (Phase 12 owner decision D4b): the deck manifest
schema plus compat fixtures, with one CI-wired consumer (this script, run
from bin/check quick). Stdlib only (json/re/pathlib/sys).

Conventions:
  spec/fixtures/manifest-*.json   must validate against deck-manifest.schema.json
  spec/fixtures/invalid-*.json    must FAIL validation (rejection proof)
  spec/fixtures/manifest-forward-compat.json must carry a schema_version
      above the MANIFEST_SCHEMA_VERSION parsed from crates/local-store,
      so it stays a genuine newer-version case as the code evolves.

The validator implements exactly the schema keywords used
(type/required/properties/pattern/minimum/additionalProperties) and fails
closed on anything else.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec"
FIXTURES = SPEC / "fixtures"
MANIFEST_SCHEMA = SPEC / "deck-manifest.schema.json"
LOCAL_STORE_SRC = ROOT / "crates" / "local-store" / "src"

SUPPORTED_SCHEMA_KEYWORDS = frozenset(
    {"type", "required", "properties", "pattern", "minimum", "additionalProperties"}
)
SUPPORTED_TYPES = {"object", "string", "integer"}


def fail_closed(schema: object, where: str, problems: list[str]) -> None:
    if isinstance(schema, dict):
        for keyword in schema:
            if keyword.startswith("$") or keyword in {"title", "description"}:
                continue
            if keyword not in SUPPORTED_SCHEMA_KEYWORDS:
                problems.append(f"{where}: unsupported schema keyword {keyword!r}")
        for name, subschema in schema.get("properties", {}).items():
            fail_closed(subschema, f"{where}.{name}", problems)


def validate(schema: dict, value: object, where: str, problems: list[str]) -> None:
    expected = schema.get("type")
    if expected not in SUPPORTED_TYPES:
        problems.append(f"{where}: unsupported type {expected!r}")
        return
    if expected == "object":
        if not isinstance(value, dict):
            problems.append(f"{where}: expected object")
            return
        for name in schema.get("required", []):
            if name not in value:
                problems.append(f"{where}: missing required property {name!r}")
        properties = schema.get("properties", {})
        for name, item in value.items():
            if name in properties:
                validate(properties[name], item, f"{where}.{name}", problems)
            elif schema.get("additionalProperties") is False:
                problems.append(f"{where}: additional property {name!r} forbidden")
        return
    if expected == "string":
        if not isinstance(value, str):
            problems.append(f"{where}: expected string")
            return
        pattern = schema.get("pattern")
        if pattern is not None and re.fullmatch(pattern, value) is None:
            problems.append(f"{where}: {value!r} does not match {pattern!r}")
        return
    if expected == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            problems.append(f"{where}: expected integer")
            return
        minimum = schema.get("minimum")
        if minimum is not None and value < minimum:
            problems.append(f"{where}: {value} below minimum {minimum}")


def manifest_schema_version() -> int:
    pattern = re.compile(r"pub const MANIFEST_SCHEMA_VERSION: u32 = (\d+);")
    for source in sorted(LOCAL_STORE_SRC.glob("*.rs")):
        match = pattern.search(source.read_text())
        if match is not None:
            return int(match.group(1))
    raise SystemExit("MANIFEST_SCHEMA_VERSION not found under crates/local-store/src/")


def main() -> int:
    problems: list[str] = []
    try:
        schema = json.loads(MANIFEST_SCHEMA.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"cannot read {MANIFEST_SCHEMA.relative_to(ROOT)}: {error}", file=sys.stderr)
        return 1
    fail_closed(schema, "deck-manifest.schema.json", problems)

    code_version = manifest_schema_version()
    checked_valid = 0
    checked_invalid = 0
    forward_version: int | None = None
    for fixture in sorted(FIXTURES.glob("*.json")):
        name = fixture.name
        try:
            value = json.loads(fixture.read_text())
        except (OSError, json.JSONDecodeError) as error:
            problems.append(f"{name}: unreadable JSON: {error}")
            continue
        item_problems: list[str] = []
        validate(schema, value, name, item_problems)
        if name.startswith("invalid-"):
            checked_invalid += 1
            if not item_problems:
                problems.append(f"{name}: expected-invalid fixture passed validation")
            continue
        if name.startswith("manifest-"):
            checked_valid += 1
            problems.extend(item_problems)
            if name == "manifest-forward-compat.json" and isinstance(value, dict):
                version = value.get("schema_version")
                forward_version = version if isinstance(version, int) else None
            continue
        problems.append(f"{name}: fixture must start with manifest- or invalid-")

    if checked_valid < 2:
        problems.append(f"expected >=2 manifest fixtures, found {checked_valid}")
    if forward_version is None:
        problems.append("manifest-forward-compat.json carries no integer schema_version")
    elif forward_version <= code_version:
        problems.append(
            f"forward-compat fixture version {forward_version} is not above "
            f"code MANIFEST_SCHEMA_VERSION {code_version}"
        )

    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        return 1
    print(
        f"spec fixtures hold: {checked_valid} manifest fixtures valid, "
        f"{checked_invalid} invalid fixtures rejected, "
        f"forward-compat v{forward_version} above code v{code_version}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
