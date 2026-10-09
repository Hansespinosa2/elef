import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkRoute, parseLibraryRoute, parseWorkRoute } from "../src/application/router.js";

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

test("router resolves the product work deep links", () => {
  assert.deepEqual(parseWorkRoute("/documents/new"), { kind: "document", id: null, view: "new" });
  assert.deepEqual(parseWorkRoute("/presentations/new"), { kind: "presentation", id: null, view: "new" });
  assert.deepEqual(parseWorkRoute("/documents/12/edit"), { kind: "document", id: "12", view: "edit" });
  assert.deepEqual(parseWorkRoute("/presentations/7/edit"), { kind: "presentation", id: "7", view: "edit" });
  assert.deepEqual(parseWorkRoute("/documents/12"), { kind: "document", id: "12", view: "show" });
  assert.deepEqual(parseWorkRoute("/presentations/7/present"), { kind: "presentation", id: "7", view: "present" });
  assert.deepEqual(parseWorkRoute("/documents/12/print"), { kind: "document", id: "12", view: "print" });
  assert.deepEqual(parseWorkRoute("/presentations/7/history"), {
    kind: "presentation",
    id: "7",
    view: "history",
  });
  assert.deepEqual(parseWorkRoute("http://localhost:3000/documents/12/edit?editor_mode=visual"), {
    kind: "document",
    id: "12",
    view: "edit",
  });
  assert.equal(isWorkRoute("/documents/12/edit"), true);
});

test("router rejects non-work paths", () => {
  assert.equal(parseWorkRoute("/"), null);
  assert.equal(parseWorkRoute("/documents"), null);
  assert.equal(parseWorkRoute("/documents/12/publish"), null);
  assert.equal(parseWorkRoute("/documents/12/edit/extra"), null);
  assert.equal(parseWorkRoute("/settings"), null);
  assert.equal(parseWorkRoute("::::"), null);
  // Trailing slashes resolve to the same route (the router strips them).
  assert.deepEqual(parseWorkRoute("/documents/12/"), { kind: "document", id: "12", view: "show" });
  assert.deepEqual(parseWorkRoute("/presentations/7/edit/"), { kind: "presentation", id: "7", view: "edit" });
  assert.deepEqual(parseWorkRoute("/documents/new/"), { kind: "document", id: null, view: "new" });
  assert.equal(isWorkRoute("/documents"), false);
});
