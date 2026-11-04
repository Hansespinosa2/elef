import { test } from "node:test";
import assert from "node:assert/strict";
import { isDefaultWorkTitle, nextDefaultWorkTitle } from "../src/features/library/default_titles.js";

test("first default titles use the bare server-matching base", () => {
  assert.equal(nextDefaultWorkTitle("document", []), "Untitled document");
  assert.equal(nextDefaultWorkTitle("presentation", []), "Untitled presentation");
});

test("a taken base counts up with a space suffix like the server", () => {
  assert.equal(nextDefaultWorkTitle("document", ["Untitled document"]), "Untitled document 2");
  assert.equal(
    nextDefaultWorkTitle("document", ["Untitled document", "Untitled document 2"]),
    "Untitled document 3",
  );
});

test("collision check ignores case and canonical Unicode differences", () => {
  assert.equal(nextDefaultWorkTitle("document", ["UNTITLED DOCUMENT"]), "Untitled document 2");
  assert.equal(
    nextDefaultWorkTitle("presentation", ["untitled PRESENTATION", "Untitled presentation 2"]),
    "Untitled presentation 3",
  );
});

test("unrelated titles never shift the default", () => {
  assert.equal(
    nextDefaultWorkTitle("document", ["Alpha doc", "Untitled presentation"]),
    "Untitled document",
  );
});

test("generated untitled names are adoptable", () => {
  assert.equal(isDefaultWorkTitle("Untitled document"), true);
  assert.equal(isDefaultWorkTitle("Untitled presentation"), true);
  assert.equal(isDefaultWorkTitle("Untitled Document"), true);
  assert.equal(isDefaultWorkTitle("Untitled presentation 2"), true);
  assert.equal(isDefaultWorkTitle("  Untitled document 12  "), true);
  assert.equal(isDefaultWorkTitle(""), true);
});

test("named works are never adoptable", () => {
  assert.equal(isDefaultWorkTitle("E2E seed"), false);
  assert.equal(isDefaultWorkTitle("Before E2E"), false);
  assert.equal(isDefaultWorkTitle("Untitled musings"), false);
  assert.equal(isDefaultWorkTitle("Untitled document draft"), false);
  assert.equal(isDefaultWorkTitle("My Untitled document"), false);
  assert.equal(isDefaultWorkTitle(null), false);
  assert.equal(isDefaultWorkTitle(undefined), false);
});
