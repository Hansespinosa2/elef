import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLibraryRoute } from "../src/application/router.js";

test("router resolves the three library deep links", () => {
  assert.deepEqual(parseLibraryRoute("/"), { filter: "all" });
  assert.deepEqual(parseLibraryRoute("/documents"), { filter: "documents" });
  assert.deepEqual(parseLibraryRoute("/presentations"), { filter: "presentations" });
});

test("router tolerates full URLs and trailing slashes", () => {
  assert.deepEqual(parseLibraryRoute("http://localhost:3000/documents/"), { filter: "documents" });
  assert.deepEqual(parseLibraryRoute("/presentations?x=1"), { filter: "presentations" });
});

test("router rejects non-library paths", () => {
  assert.equal(parseLibraryRoute("/documents/1/edit"), null);
  assert.equal(parseLibraryRoute("/settings"), null);
  assert.equal(parseLibraryRoute("::::"), null);
});
